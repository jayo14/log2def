from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth.models import User
from api.models import StudentProfile, ReportProject
from api.enums import UserTier


class Command(BaseCommand):
    help = "View or change user tier (basic or pro)"

    def add_arguments(self, parser):
        parser.add_argument(
            'identifier',
            nargs='?',
            type=str,
            help="Username, email, or user ID"
        )
        parser.add_argument(
            'tier',
            nargs='?',
            type=str,
            choices=['basic', 'pro', 'BASIC', 'PRO'],
            help="Target tier: basic or pro"
        )
        parser.add_argument(
            '--list',
            action='store_true',
            help="List all users with their current tier"
        )

    def handle(self, *args, **options):
        if options['list']:
            self.stdout.write(self.style.MIGRATE_HEADING("Listing all users and tiers:"))
            for u in User.objects.all().order_by('id'):
                profile, _ = StudentProfile.objects.get_or_create(user=u)
                pro_projects = u.projects.filter(tier=UserTier.PRO).count()
                total_projects = u.projects.count()
                status_color = self.style.SUCCESS if profile.tier == UserTier.PRO else self.style.WARNING
                self.stdout.write(
                    f"ID: {u.id:<4} | Username: {u.username:<24} | Email: {u.email:<30} | "
                    f"Tier: {status_color(profile.tier.upper()):<12} | Projects: {total_projects} ({pro_projects} pro)"
                )
            return

        identifier = options.get('identifier')
        tier_input = options.get('tier')

        if not identifier:
            raise CommandError("Please provide a username, email, or user ID, or pass --list.")

        # Find user by ID, username, or email
        user = None
        if identifier.isdigit():
            user = User.objects.filter(id=int(identifier)).first()
        if not user:
            user = User.objects.filter(username=identifier).first()
        if not user:
            user = User.objects.filter(email__iexact=identifier).first()

        if not user:
            raise CommandError(f"User not found for identifier: '{identifier}'")

        profile, _ = StudentProfile.objects.get_or_create(user=user)

        if not tier_input:
            self.stdout.write(f"User '{user.username}' (ID: {user.id}) current tier: {profile.tier.upper()}")
            return

        target_tier = UserTier.PRO if tier_input.lower() == 'pro' else UserTier.BASIC
        old_tier = profile.tier
        profile.tier = target_tier
        profile.save(update_fields=['tier'])

        # Also update all user's projects to match
        projects_count = user.projects.count()
        user.projects.all().update(tier=target_tier)

        self.stdout.write(
            self.style.SUCCESS(
                f"Successfully updated user '{user.username}' (ID: {user.id}) "
                f"from {old_tier.upper()} to {target_tier.upper()}! "
                f"Updated {projects_count} associated project(s)."
            )
        )
