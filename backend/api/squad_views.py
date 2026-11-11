from decimal import Decimal
from django.shortcuts import redirect
from django.db import transaction as db_transaction
from django.utils import timezone
from django.conf import settings
from django.http import FileResponse, Http404
from django.core.exceptions import ObjectDoesNotExist
from rest_framework import generics, status, views
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiTypes, OpenApiResponse
from .feature_flags import is_feature_enabled, require_feature_flag
from .models import ReportProject, PaymentOrder, SquadWebhookEvent, Report
from .serializers import PaymentOrderSerializer
from .enums import UserTier
from .squad_service import SquadError, initiate_transaction, verify_transaction, verify_webhook_signature
from .telegram_service import send_payment_notification
from .report_generator import generate_full_report
from .document_exporter import generate_docx_report, export_report_documents
from .document_quality import QualityGateError
from pathlib import Path
import re
import os
import uuid
import json
import logging

logger = logging.getLogger(__name__)


def _get_user_project_or_404(user, project_id):
    try:
        return ReportProject.objects.get(id=project_id, user=user)
    except ReportProject.DoesNotExist:
        raise Http404('Project not found')


class SquadInitializeView(views.APIView):
    """Server-side Squad transaction initialization.

    Creates an internal PaymentOrder, then asks Squad for a checkout URL.
    The frontend redirects the customer to that URL.
    """
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Squad Payments'],
        summary='Initialize Squad checkout for a payment order',
        request=OpenApiTypes.OBJECT,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request, project_id):
        project = _get_user_project_or_404(request.user, project_id)

        order_type = request.data.get('order_type', 'digital')
        if order_type not in dict(PaymentOrder.ORDER_TYPES):
            return Response(
                {'error': 'Invalid order_type. Must be "digital" or "delivery".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Pro tier enforcement: No payment required for digital, delivery is disabled
        if project.is_pro:
            if order_type == 'delivery':
                return Response(
                    {'error': 'Physical delivery is not available on the Pro tier.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {
                    'message': 'Pro tier includes free digital downloads. No payment is required.',
                    'is_pro': True,
                    'digital_unlocked': True,
                },
                status=status.HTTP_200_OK,
            )

        # Prices are controlled exclusively by the backend — never trust the client
        if order_type == 'digital':
            amount = 2000.00
        else:
            amount = 4000.00
        amount_kobo = int(amount * 100)
        currency = 'NGN'

        # Delivery details for physical orders
        recipient_name = request.data.get('recipient_name', '') or ''
        phone_number = request.data.get('phone_number', '') or ''
        campus_location = request.data.get('campus_location', '') or ''
        custom_address = request.data.get('custom_address', '') or ''
        delivery_date = request.data.get('delivery_date', '') or ''
        notes = request.data.get('notes', '') or ''

        # Validate physical delivery fields
        if order_type == 'delivery':
            if not phone_number:
                return Response(
                    {'error': 'Phone number is required for delivery orders.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not recipient_name:
                return Response(
                    {'error': 'Recipient name is required for delivery orders.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Build callback URL for Squad redirect after payment
        callback_url = request.data.get('callback_url') or ''
        if not callback_url:
            frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
            callback_url = f'{frontend_url}/dashboard/payment-callback'

        # Generate a unique transaction reference
        transaction_ref = f'L2D_TXN_{uuid.uuid4().hex[:12]}'

        # Squad metadata (includes internal order reference for cross-referencing)
        squad_metadata = {
            'order_type': order_type,
            'project_id': str(project.id),
            'user_id': str(request.user.id),
            'recipient_name': recipient_name,
            'phone_number': phone_number,
            'campus_location': campus_location,
            'custom_address': custom_address,
            'delivery_date': delivery_date,
            'notes': notes,
        }

        try:
            checkout = initiate_transaction(
                email=request.user.email or '',
                amount_kobo=amount_kobo,
                currency=currency,
                transaction_ref=transaction_ref,
                callback_url=callback_url,
                customer_name=recipient_name or request.user.get_full_name() or request.user.username,
                payment_channels=['card', 'bank', 'transfer'],
                metadata=squad_metadata,
            )
        except SquadError as exc:
            logger.exception('Squad checkout initialization failed')
            return Response(
                {'error': f'Payment initialization failed: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # Create internal order record (pending)
        order = PaymentOrder.objects.create(
            project=project,
            user=request.user,
            order_type=order_type,
            amount=amount,
            amount_kobo=amount_kobo,
            currency=currency,
            transaction_reference=transaction_ref,
            squad_transaction_reference='',
            status='pending',
            fulfilment_status='pending',
            recipient_name=recipient_name,
            phone_number=phone_number,
            campus_location=campus_location,
            custom_address=custom_address,
            delivery_date=delivery_date,
            notes=notes,
            squad_metadata=squad_metadata,
            callback_url=callback_url,
        )

        return Response({
            'checkout_url': checkout['checkout_url'],
            'transaction_reference': transaction_ref,
            'order_reference': order.order_reference,
            'amount': str(amount),
            'amount_kobo': amount_kobo,
            'currency': currency,
            'status': 'pending',
        }, status=status.HTTP_200_OK)


class SquadCallbackView(views.APIView):
    """Squad redirect callback after customer completes checkout.

    Squad redirects the customer here with the transaction reference.
    We verify the transaction before marking the order paid.
    """
    permission_classes = (AllowAny,)

    @extend_schema(
        tags=['Squad Payments'],
        summary='Squad checkout redirect callback',
        responses={200: OpenApiTypes.OBJECT, 302: OpenApiTypes.OBJECT},
    )
    def get(self, request):
        transaction_ref = (
            request.query_params.get('transaction_ref')
            or request.query_params.get('transaction_reference')
        )
        if not transaction_ref:
            return Response(
                {'error': 'No transaction reference provided.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Verify with Squad before trusting anything
        try:
            verification = verify_transaction(transaction_ref)
        except SquadError as exc:
            logger.exception('Squad verification failed in callback')
            frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
            return redirect(f'{frontend_url}/dashboard/payment-failed?error=verification_failed')

        data = verification.get('data', {})
        tx_status = (data.get('transaction_status') or '').strip().lower()
        tx_amount = data.get('transaction_amount')
        tx_currency = data.get('transaction_currency_id') or 'NGN'
        tx_ref = data.get('transaction_ref') or transaction_ref

        # Find the internal order
        try:
            order = PaymentOrder.objects.get(transaction_reference=tx_ref)
        except PaymentOrder.DoesNotExist:
            try:
                order = PaymentOrder.objects.get(squad_transaction_reference=tx_ref)
            except PaymentOrder.DoesNotExist:
                frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
                return redirect(f'{frontend_url}/dashboard/payment-failed?error=order_not_found')

        # Verify amount and currency match — use Decimal for exact comparison
        expected_amount = Decimal(str(order.amount))
        if tx_amount is not None:
            try:
                tx_amount_decimal = Decimal(str(tx_amount))
            except (ValueError, TypeError):
                tx_amount_decimal = None
            if tx_amount_decimal is not None and tx_amount_decimal != expected_amount:
                logger.warning(
                    'Amount mismatch for order %s: expected %s, got %s',
                    order.order_reference, expected_amount, tx_amount
                )
                order.status = 'review_required'
                order.save(update_fields=['status', 'updated_at'])
                frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
                return redirect(f'{frontend_url}/dashboard/payment-failed?error=amount_mismatch')

        if tx_currency != order.currency:
            logger.warning(
                'Currency mismatch for order %s: expected %s, got %s',
                order.order_reference, order.currency, tx_currency
            )
            order.status = 'review_required'
            order.save(update_fields=['status', 'updated_at'])
            frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
            return redirect(f'{frontend_url}/dashboard/payment-failed?error=currency_mismatch')

        # Update order based on verification — use atomic transaction for consistency
        if tx_status == 'success':
            with db_transaction.atomic():
                # Re-fetch order with select_for_update to prevent race conditions
                order = PaymentOrder.objects.select_for_update().get(pk=order.pk)

                if order.status != 'paid':
                    order.status = 'paid'
                    order.squad_transaction_reference = tx_ref
                    order.paid_at = timezone.now()
                    order.webhook_received_at = timezone.now()
                    if order.order_type == 'digital':
                        order.digital_files_unlocked = True
                        order.fulfilment_status = 'ready'
                    else:
                        order.fulfilment_status = 'processing'
                    order.save()

                    # Send Telegram notification (non-fatal)
                    try:
                        send_payment_notification(
                            order_reference=order.order_reference,
                            customer_name=order.recipient_name or order.user.get_full_name() or order.user.username,
                            order_type=order.get_order_type_display(),
                            amount=str(order.amount),
                            phone_number=order.phone_number,
                            delivery_address=order.custom_address or order.campus_location,
                            preferred_date=order.delivery_date,
                            fulfilment_status=order.fulfilment_status,
                        )
                    except Exception:
                        logger.exception('Telegram notification failed for order %s', order.order_reference)

            frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
            return redirect(
                f'{frontend_url}/dashboard/payment-success?order_ref={order.order_reference}'
                f'&transaction_ref={order.squad_transaction_reference}'
                f'&type={order.order_type}'
            )
        else:
            with db_transaction.atomic():
                order = PaymentOrder.objects.select_for_update().get(pk=order.pk)
                order.status = 'failed'
                order.save(update_fields=['status', 'updated_at'])
            frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
            return redirect(
                f'{frontend_url}/dashboard/payment-failed?order_ref={order.order_reference}'
            )


class SquadWebhookView(views.APIView):
    """Squad webhook handler for asynchronous payment notifications.

    Verifies the HMAC-SHA512 signature, checks idempotency, and updates
    the order within a database transaction.
    """
    permission_classes = (AllowAny,)

    @extend_schema(
        tags=['Squad Payments'],
        summary='Squad webhook endpoint',
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request):
        # Read raw body for signature verification
        raw_body = request.body

        # Verify signature
        signature = (
            request.headers.get('x-squad-encrypted-body')
            or request.META.get('HTTP_X_SQUAD_ENCRYPTED_BODY', '')
        )
        if not verify_webhook_signature(raw_body, signature):
            logger.warning('Invalid Squad webhook signature received')
            return Response({'error': 'Invalid signature'}, status=status.HTTP_400_BAD_REQUEST)

        # Parse payload
        try:
            payload = json.loads(raw_body)
        except (json.JSONDecodeError, ValueError):
            logger.warning('Invalid JSON in Squad webhook payload')
            return Response({'error': 'Invalid JSON'}, status=status.HTTP_400_BAD_REQUEST)

        event_type = payload.get('Event', '')
        body = payload.get('Body', {})
        tx_ref = body.get('transaction_ref') or payload.get('TransactionRef', '')
        tx_status = body.get('transaction_status', '')
        tx_amount = body.get('amount')
        tx_currency = body.get('currency', 'NGN')

        # Idempotency: check if already processed
        event_id = payload.get('TransactionRef') or tx_ref or ''
        if SquadWebhookEvent.objects.filter(event_id=event_id).exists():
            logger.info('Duplicate webhook event ignored: %s', event_id)
            return Response({'status': 'duplicate'}, status=status.HTTP_200_OK)

        # Record the webhook event
        webhook_event = SquadWebhookEvent.objects.create(
            event_id=event_id,
            transaction_reference=tx_ref,
            event_type=event_type,
            payload=payload,
            success=False,
        )

        # Find the internal order
        try:
            order = PaymentOrder.objects.get(transaction_reference=tx_ref)
        except PaymentOrder.DoesNotExist:
            try:
                order = PaymentOrder.objects.get(squad_transaction_reference=tx_ref)
            except PaymentOrder.DoesNotExist:
                webhook_event.error_message = f'Order not found for transaction {tx_ref}'
                webhook_event.save()
                logger.warning('Webhook for unknown transaction: %s', tx_ref)
                return Response({'error': 'Order not found'}, status=status.HTTP_404_NOT_FOUND)

        # Verify amount and currency — use Decimal for exact comparison
        expected_amount = Decimal(str(order.amount))
        if tx_amount is not None:
            try:
                tx_amount_decimal = Decimal(str(tx_amount))
            except (ValueError, TypeError):
                tx_amount_decimal = None
            if tx_amount_decimal is not None and tx_amount_decimal != expected_amount:
                webhook_event.error_message = f'Amount mismatch: expected {expected_amount}, got {tx_amount}'
                webhook_event.success = True
                webhook_event.save()
                order.status = 'review_required'
                order.save(update_fields=['status', 'updated_at'])
                logger.warning(
                    'Webhook amount mismatch for order %s: expected %s, got %s',
                    order.order_reference, expected_amount, tx_amount
                )
                return Response({'error': 'Amount mismatch'}, status=status.HTTP_400_BAD_REQUEST)

        if tx_currency != order.currency:
            webhook_event.error_message = f'Currency mismatch: expected {order.currency}, got {tx_currency}'
            webhook_event.success = True
            webhook_event.save()
            order.status = 'review_required'
            order.save(update_fields=['status', 'updated_at'])
            logger.warning(
                'Webhook currency mismatch for order %s: expected %s, got %s',
                order.order_reference, order.currency, tx_currency
            )
            return Response({'error': 'Currency mismatch'}, status=status.HTTP_400_BAD_REQUEST)

        # Process within a database transaction
        with db_transaction.atomic():
            # Re-fetch order with select_for_update to prevent race conditions
            order = PaymentOrder.objects.select_for_update().get(pk=order.pk)

            if order.status == 'paid':
                # Already processed — idempotent
                webhook_event.success = True
                webhook_event.save()
                return Response({'status': 'already_processed'}, status=status.HTTP_200_OK)

            if tx_status.lower() in ('success', 'successful'):
                order.status = 'paid'
                order.squad_transaction_reference = tx_ref
                order.paid_at = timezone.now()
                order.webhook_received_at = timezone.now()
                if order.order_type == 'digital':
                    order.digital_files_unlocked = True
                    order.fulfilment_status = 'ready'
                else:
                    order.fulfilment_status = 'processing'
                order.save()

                # Send Telegram notification (non-fatal)
                try:
                    send_payment_notification(
                        order_reference=order.order_reference,
                        customer_name=order.recipient_name or order.user.get_full_name() or order.user.username,
                        order_type=order.get_order_type_display(),
                        amount=str(order.amount),
                        phone_number=order.phone_number,
                        delivery_address=order.custom_address or order.campus_location,
                        preferred_date=order.delivery_date,
                        fulfilment_status=order.fulfilment_status,
                    )
                except Exception:
                    logger.exception('Telegram notification failed for order %s', order.order_reference)

                webhook_event.success = True
                webhook_event.save()
                return Response({'status': 'paid'}, status=status.HTTP_200_OK)
            else:
                order.status = 'failed'
                order.save(update_fields=['status', 'updated_at'])
                webhook_event.success = True
                webhook_event.save()
                return Response({'status': 'failed'}, status=status.HTTP_200_OK)


class SquadVerifyView(views.APIView):
    """On-demand transaction verification endpoint.

    Allows the frontend to poll or manually verify a transaction status.
    """
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Squad Payments'],
        summary='Verify a Squad transaction',
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request, project_id):
        project = _get_user_project_or_404(request.user, project_id)
        transaction_ref = request.query_params.get('transaction_ref')
        if not transaction_ref:
            return Response(
                {'error': 'transaction_ref query parameter is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            order = project.payment_orders.get(transaction_reference=transaction_ref)
        except PaymentOrder.DoesNotExist:
            return Response({'error': 'Order not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Verify with Squad
        try:
            verification = verify_transaction(transaction_ref)
        except SquadError as exc:
            return Response(
                {'error': f'Verification failed: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        data = verification.get('data', {})
        tx_status = (data.get('transaction_status') or '').strip().lower()
        tx_amount = data.get('transaction_amount')
        tx_currency = data.get('transaction_currency_id') or 'NGN'

        return Response({
            'transaction_reference': transaction_ref,
            'order_reference': order.order_reference,
            'squad_status': tx_status,
            'squad_amount': tx_amount,
            'squad_currency': tx_currency,
            'order_status': order.status,
            'amount_matches': tx_amount is None or Decimal(str(tx_amount)) == Decimal(str(order.amount)),
            'currency_matches': tx_currency == order.currency,
        })


class SecureDigitalDownloadView(views.APIView):
    """Protected download for paid digital orders.

    Verifies payment status and customer ownership before serving files.
    No permanent public URLs are exposed.
    """
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Squad Payments'],
        summary='Secure download for paid digital report',
        responses={200: OpenApiTypes.BINARY, 403: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT},
    )
    def get(self, request, project_id, format_type):
        project = _get_user_project_or_404(request.user, project_id)

        if format_type not in ('pdf', 'docx'):
            return Response({'error': 'Invalid format. Use "pdf" or "docx".'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Enforce tier: Pro tier does not need to make payments to download
        order = None
        if not project.is_pro:
            try:
                order = project.payment_orders.filter(
                    user=request.user,
                    order_type='digital',
                    status='paid',
                    digital_files_unlocked=True,
                ).latest('paid_at')
            except PaymentOrder.DoesNotExist:
                return Response({'error': 'No paid digital order found for this project. Please complete payment.'},
                                status=status.HTTP_403_FORBIDDEN)
        else:
            order = project.payment_orders.filter(
                user=request.user,
                order_type='digital',
                status='paid',
                digital_files_unlocked=True,
            ).order_by('-paid_at').first()

        # Reuse existing generated files instead of regenerating unnecessarily
        try:
            report = project.report
        except Report.DoesNotExist:
            report = generate_full_report(project)

        clean_title = re.sub(r'[^a-zA-Z0-9_\-]', '_', project.title or "SIWES_Report")
        expected_filename = f"{clean_title}_v{report.version}.{format_type}"
        export_dir = Path(settings.MEDIA_ROOT) / "projects" / str(project.id) / "exports"
        existing_file = export_dir / expected_filename

        try:
            target_path = None
            if existing_file.exists() and existing_file.stat().st_size > 0 and existing_file.stat().st_mtime >= report.updated_at.timestamp():
                target_path = str(existing_file)
            else:
                if format_type == 'docx':
                    try:
                        target_path = generate_docx_report(report, enforce_quality=True)
                    except QualityGateError as qe:
                        logger.warning(f"Quality gate warning for project {project.id} during download; falling back to enforce_quality=False: {qe}")
                        target_path = generate_docx_report(report, enforce_quality=False)
                else:
                    # PDF
                    try:
                        export_result = export_report_documents(report, enforce_quality=True)
                        target_path = export_result['pdf_path']
                    except QualityGateError as qe:
                        logger.warning(f"Quality gate warning for project {project.id} during PDF export; falling back to enforce_quality=False: {qe}")
                        export_result = export_report_documents(report, enforce_quality=False)
                        target_path = export_result['pdf_path']

            if not target_path or not os.path.exists(target_path):
                return Response({'error': f'{format_type.upper()} document not available.'},
                                status=status.HTTP_404_NOT_FOUND)

            resolved_path = os.path.realpath(target_path)
            media_root = os.path.realpath(settings.MEDIA_ROOT)
            if not resolved_path.startswith(media_root):
                return Response({'error': 'Access denied.'}, status=status.HTTP_403_FORBIDDEN)

            filename = os.path.basename(resolved_path)
            if order:
                order.download_count += 1
                order.save(update_fields=['download_count'])

            content_type = (
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                if format_type == 'docx' else 'application/pdf'
            )
            return FileResponse(
                open(resolved_path, 'rb'),
                as_attachment=True,
                filename=filename,
                content_type=content_type,
            )
        except Exception as exc:
            logger.exception('Download generation failed')
            return Response({'error': f'Download failed: {exc}'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# --- Feature flag gating ---
# The payment_processing feature flag defaults to False.
# Only views that initiate or expose payment functionality are gated.
# Callback and webhook endpoints must remain accessible regardless of flag state
# because Squad will call them even if the flag is temporarily disabled.
SquadInitializeView = require_feature_flag('payment_processing')(SquadInitializeView)
SquadVerifyView = require_feature_flag('payment_processing')(SquadVerifyView)
SecureDigitalDownloadView = require_feature_flag('payment_processing')(SecureDigitalDownloadView)
