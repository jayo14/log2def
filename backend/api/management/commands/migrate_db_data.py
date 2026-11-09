import sys
import time
from typing import List, Dict, Any, Tuple
from django.core.management.base import BaseCommand
from django.db import connections, connection
import psycopg2
from psycopg2.extras import RealDictCursor


# Ordered list of models/tables to ensure referential integrity
ORDERED_APP_TABLES = [
    # Auth tables
    'auth_user',
    'auth_group',
    'auth_permission',
    'auth_group_permissions',
    'auth_user_groups',
    'auth_user_user_permissions',
    'django_content_type',
    'django_admin_log',
    'django_session',
    # Log2def Domain Models
    'api_reporttemplate',
    'api_reportproject',
    'api_studentprofile',
    'api_sourcedocument',
    'api_logbookpage',
    'api_weekrecord',
    'api_weekrecord_source_pages',
    'api_extractedpage',
    'api_logbookentry',
    'api_fact',
    'api_fact_source_entry_ids',
    'api_dayentry',
    'api_report',
    'api_reportsection',
    'api_reportparagraph',
    'api_reportparagraph_facts',
    'api_reportversion',
    'api_reportimage',
    'api_defencesession',
    'api_defencequestion',
    'api_paymentorder',
    'api_squadwebhookevent',
    'api_telegramnotificationlog',
    'api_useranalyticsevent',
]


class Command(BaseCommand):
    help = "Safely migrates data between PostgreSQL databases (e.g. from Neon to Rumpty Cloud) with sequence resets."

    def add_arguments(self, parser):
        parser.add_argument(
            '--source-url',
            required=False,
            help='Source database PostgreSQL connection string.',
        )
        parser.add_argument(
            '--target-url',
            required=False,
            help='Target database PostgreSQL connection string (defaults to current active database).',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=1000,
            help='Batch size for transferring rows (default: 1000).',
        )
        parser.add_argument(
            '--tables',
            nargs='*',
            help='Optional specific table names to migrate. If omitted, all domain tables are migrated in topological order.',
        )
        parser.add_argument(
            '--reset-sequences',
            action='store_true',
            default=True,
            help='Reset all PostgreSQL auto-increment sequences after data migration.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Simulate migration without modifying target database.',
        )

    def handle(self, *args, **options):
        source_url = options.get('source_url')
        target_url = options.get('target_url')
        batch_size = options.get('batch_size', 1000)
        dry_run = options.get('dry_run', False)
        requested_tables = options.get('tables')

        self.stdout.write(self.style.MIGRATE_HEADING("Safe Cross-Database Migration Tool"))

        if not source_url:
            self.stderr.write(self.style.ERROR(
                "Source database URL is required. Pass --source-url <postgresql://...>"
            ))
            return

        # Connect to Source
        self.stdout.write(f"Connecting to source database...")
        try:
            source_conn = psycopg2.connect(source_url)
            source_conn.set_session(readonly=True, autocommit=True)
            self.stdout.write(self.style.SUCCESS("  Source connection established."))
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"  Failed to connect to source database: {e}"))
            return

        # Connect to Target
        self.stdout.write(f"Connecting to target database...")
        try:
            if target_url:
                target_conn = psycopg2.connect(target_url)
            else:
                target_conn = connection.connection
            self.stdout.write(self.style.SUCCESS("  Target connection established."))
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"  Failed to connect to target database: {e}"))
            source_conn.close()
            return

        # Determine tables to migrate
        with source_conn.cursor() as s_cur:
            s_cur.execute("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                ORDER BY table_name;
            """)
            available_source_tables = set(r[0] for r in s_cur.fetchall())

        with target_conn.cursor() as t_cur:
            t_cur.execute("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                ORDER BY table_name;
            """)
            available_target_tables = set(r[0] for r in t_cur.fetchall())

        common_tables = available_source_tables.intersection(available_target_tables)
        if requested_tables:
            tables_to_migrate = [t for t in requested_tables if t in common_tables]
        else:
            # Follow ordered list first, then any other common tables
            ordered_set = set(ORDERED_APP_TABLES)
            tables_to_migrate = [t for t in ORDERED_APP_TABLES if t in common_tables]
            tables_to_migrate += [t for t in sorted(common_tables) if t not in ordered_set]

        self.stdout.write(f"Found {len(tables_to_migrate)} table(s) to process.\n")

        migration_summary: List[Tuple[str, int, int]] = []

        try:
            with target_conn.cursor() as t_cur:
                if not dry_run:
                    # Defer triggers / constraint checks for fast & reliable bulk loading
                    t_cur.execute("SET session_replication_role = 'replica';")

                for table in tables_to_migrate:
                    self.stdout.write(f"Processing table '{table}'...")

                    # Fetch columns
                    with source_conn.cursor() as s_cur:
                        s_cur.execute(f"""
                            SELECT column_name
                            FROM information_schema.columns
                            WHERE table_schema = 'public' AND table_name = %s
                            ORDER BY ordinal_position;
                        """, (table,))
                        columns = [r[0] for r in s_cur.fetchall()]

                        s_cur.execute(f'SELECT count(*) FROM "{table}";')
                        src_count = s_cur.fetchone()[0]

                    if src_count == 0:
                        self.stdout.write(f"  Table '{table}' has 0 rows in source. Skipping.")
                        migration_summary.append((table, 0, 0))
                        continue

                    col_names = ", ".join(f'"{c}"' for c in columns)
                    col_placeholders = ", ".join(["%s"] * len(columns))

                    insert_sql = f'INSERT INTO "{table}" ({col_names}) VALUES ({col_placeholders}) ON CONFLICT DO NOTHING;'

                    transferred = 0
                    with source_conn.cursor(cursor_factory=RealDictCursor) as s_cur:
                        s_cur.execute(f'SELECT {col_names} FROM "{table}";')
                        while True:
                            rows = s_cur.fetchmany(batch_size)
                            if not rows:
                                break

                            values = [tuple(r[c] for c in columns) for r in rows]
                            if not dry_run:
                                from psycopg2.extras import execute_batch
                                execute_batch(t_cur, insert_sql, values, page_size=batch_size)
                            transferred += len(values)

                    if not dry_run:
                        target_conn.commit()

                    self.stdout.write(self.style.SUCCESS(
                        f"  Successfully copied {transferred}/{src_count} row(s) for '{table}'."
                    ))
                    migration_summary.append((table, src_count, transferred))

                if not dry_run:
                    t_cur.execute("SET session_replication_role = 'origin';")
                    target_conn.commit()

                # Reset Sequences
                if options.get('reset_sequences') and not dry_run:
                    self.stdout.write(self.style.MIGRATE_LABEL("\nResetting PostgreSQL auto-increment sequences..."))
                    t_cur.execute("""
                        SELECT sequence_name, table_name, column_name
                        FROM (
                            SELECT
                                s.relname AS sequence_name,
                                t.relname AS table_name,
                                a.attname AS column_name
                            FROM pg_class s
                            JOIN pg_depend d ON d.objid = s.oid
                            JOIN pg_class t ON d.refobjid = t.oid
                            JOIN pg_attribute a ON d.refobjid = a.attrelid AND d.refobjsubid = a.attnum
                            WHERE s.relkind = 'S' AND t.relkind = 'r'
                        ) sub;
                    """)
                    seqs = t_cur.fetchall()
                    for seq, table, col in seqs:
                        try:
                            t_cur.execute(f"""
                                SELECT setval(
                                    pg_get_serial_sequence(%s, %s),
                                    COALESCE((SELECT MAX("{col}") FROM "{table}"), 1),
                                    (SELECT MAX("{col}") IS NOT NULL FROM "{table}")
                                );
                            """, (table, col))
                        except Exception as seq_err:
                            self.stdout.write(self.style.WARNING(f"  Warning on sequence {seq}: {seq_err}"))
                    target_conn.commit()
                    self.stdout.write(self.style.SUCCESS("  All PostgreSQL sequences updated successfully."))

        except Exception as exc:
            if not dry_run and target_conn:
                target_conn.rollback()
            self.stderr.write(self.style.ERROR(f"Data migration error: {exc}"))
            raise
        finally:
            source_conn.close()
            if target_url and target_conn:
                target_conn.close()

        self.stdout.write(self.style.SUCCESS("\nMigration Finished! Summary:"))
        for tbl, src, dst in migration_summary:
            status_style = self.style.SUCCESS if src == dst else self.style.WARNING
            self.stdout.write(status_style(f"  - {tbl}: {dst}/{src} row(s) transferred"))
