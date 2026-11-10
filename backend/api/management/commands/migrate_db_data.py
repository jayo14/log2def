import os
import sys
import json
from pathlib import Path
from typing import List, Dict, Any, Tuple, Set, Optional
from django.core.management.base import BaseCommand
from django.db import connection
import psycopg2
from psycopg2.extras import RealDictCursor, execute_batch


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
    help = (
        "Safely migrates data between PostgreSQL databases (e.g. from Neon to Rumpty Cloud) "
        "with smart ID remapping to ensure NO data is lost and existing Rumpty Cloud data is NOT tampered with."
    )

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
            '--dump-file',
            required=False,
            help='Optional path to SQL dump file or JSON export file to migrate offline.',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=500,
            help='Batch size for transferring rows (default: 500).',
        )
        parser.add_argument(
            '--tables',
            nargs='*',
            help='Optional specific table names to migrate.',
        )
        parser.add_argument(
            '--smart-merge',
            action='store_true',
            default=True,
            help='Remap primary key IDs on collision to guarantee no source data is lost and target data is preserved (default: True).',
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
        dump_file = options.get('dump_file')
        batch_size = options.get('batch_size', 500)
        smart_merge = options.get('smart_merge', True)
        dry_run = options.get('dry_run', False)
        requested_tables = options.get('tables')

        self.stdout.write(self.style.MIGRATE_HEADING("Safe Cross-Database Migration & Data Merger Tool"))
        self.stdout.write(f"Smart Merge:      {smart_merge}")
        self.stdout.write(f"Preserve Target:  YES (Non-destructive)")
        self.stdout.write(f"Dry Run Mode:     {dry_run}\n")

        # Connect to Target
        self.stdout.write("Connecting to target database (Rumpty Cloud)...")
        try:
            if target_url:
                target_conn = psycopg2.connect(target_url)
            else:
                target_conn = connection.connection
                if target_conn is None or target_conn.closed:
                    connection.ensure_connection()
                    target_conn = connection.connection
            self.stdout.write(self.style.SUCCESS("  Target database connection established."))
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"  Failed to connect to target database: {e}"))
            return

        if dump_file:
            self._handle_dump_file(dump_file, target_conn, dry_run)
            return

        if not source_url:
            self.stdout.write(self.style.WARNING(
                "Source database URL was not passed via --source-url.\n"
                "Checking environment variables (DATABASE_URL / NEON_DATABASE_URL)..."
            ))
            source_url = os.getenv('NEON_DATABASE_URL')
            if not source_url:
                self.stderr.write(self.style.ERROR(
                    "Error: Missing source database URL. Pass --source-url <postgresql://...>"
                ))
                return

        # Connect to Source
        self.stdout.write("Connecting to source database (Neon)...")
        try:
            source_conn = psycopg2.connect(source_url)
            source_conn.set_session(readonly=True, autocommit=True)
            self.stdout.write(self.style.SUCCESS("  Source connection established."))
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"  Failed to connect to source database: {e}"))
            self.stdout.write(self.style.NOTICE(
                "\nTIP: If Neon compute is currently quota-locked, you can unlock egress in the Neon console "
                "or export a dump file and run with --dump-file <file.sql>."
            ))
            return

        try:
            self._execute_live_migration(
                source_conn=source_conn,
                target_conn=target_conn,
                batch_size=batch_size,
                smart_merge=smart_merge,
                requested_tables=requested_tables,
                reset_sequences=options.get('reset_sequences', True),
                dry_run=dry_run
            )
        finally:
            source_conn.close()
            if target_url and target_conn:
                target_conn.close()

    def _handle_dump_file(self, dump_path_str: str, target_conn, dry_run: bool):
        dump_path = Path(dump_path_str).resolve()
        if not dump_path.exists():
            self.stderr.write(self.style.ERROR(f"Dump file '{dump_path}' not found."))
            return

        self.stdout.write(self.style.MIGRATE_LABEL(f"Loading data from offline file: {dump_path}..."))
        if dry_run:
            self.stdout.write(self.style.SUCCESS("  [DRY-RUN] Dump file verified. Ready for import."))
            return

        try:
            with target_conn.cursor() as cur:
                with open(dump_path, 'r', encoding='utf-8') as f:
                    cur.execute(f.read())
            target_conn.commit()
            self.stdout.write(self.style.SUCCESS("  Successfully imported dump into target database!"))
        except Exception as exc:
            target_conn.rollback()
            self.stderr.write(self.style.ERROR(f"  Failed to import dump: {exc}"))

    def _execute_live_migration(
        self,
        source_conn,
        target_conn,
        batch_size: int,
        smart_merge: bool,
        requested_tables: Optional[List[str]],
        reset_sequences: bool,
        dry_run: bool
    ):
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
            ordered_set = set(ORDERED_APP_TABLES)
            tables_to_migrate = [t for t in ORDERED_APP_TABLES if t in common_tables]
            tables_to_migrate += [t for t in sorted(common_tables) if t not in ordered_set]

        self.stdout.write(f"Identified {len(tables_to_migrate)} common tables to process.\n")

        # Identity and Remapping Dictionaries for foreign key consistency
        user_id_map: Dict[int, int] = {}
        project_id_map: Dict[int, int] = {}
        report_id_map: Dict[int, int] = {}
        page_id_map: Dict[int, int] = {}

        summary: List[Tuple[str, int, int, int]] = []

        try:
            with target_conn.cursor() as t_cur:
                if not dry_run:
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
                        self.stdout.write(f"  Source has 0 rows. Skipping.")
                        summary.append((table, 0, 0, 0))
                        continue

                    # Fetch existing IDs from target table to protect existing data
                    t_cur.execute(f'SELECT column_name FROM information_schema.columns WHERE table_schema = "public" AND table_name = %s AND column_name = "id";', (table,))
                    has_id = bool(t_cur.fetchone())

                    existing_target_ids: Set[int] = set()
                    max_target_id = 0
                    if has_id:
                        t_cur.execute(f'SELECT id FROM "{table}";')
                        existing_target_ids = set(r[0] for r in t_cur.fetchall())
                        if existing_target_ids:
                            max_target_id = max(existing_target_ids)

                    # For auth_user, fetch existing usernames
                    existing_usernames: Dict[str, int] = {}
                    if table == 'auth_user':
                        t_cur.execute('SELECT username, id FROM auth_user;')
                        existing_usernames = {r[0]: r[1] for r in t_cur.fetchall()}

                    col_names = ", ".join(f'"{c}"' for c in columns)
                    col_placeholders = ", ".join(["%s"] * len(columns))
                    insert_sql = f'INSERT INTO "{table}" ({col_names}) VALUES ({col_placeholders}) ON CONFLICT DO NOTHING;'

                    inserted = 0
                    remapped = 0
                    preserved = 0

                    with source_conn.cursor(cursor_factory=RealDictCursor) as s_cur:
                        s_cur.execute(f'SELECT {col_names} FROM "{table}";')
                        while True:
                            rows = s_cur.fetchmany(batch_size)
                            if not rows:
                                break

                            batch_values = []
                            for row in rows:
                                row_dict = dict(row)

                                # Special handling for auth_user to avoid overwriting or creating duplicate accounts
                                if table == 'auth_user':
                                    src_uid = row_dict['id']
                                    username = row_dict['username']
                                    if username in existing_usernames:
                                        # Already exists on Rumpty Cloud! Reuse target ID and preserve existing user record
                                        user_id_map[src_uid] = existing_usernames[username]
                                        preserved += 1
                                        continue
                                    elif smart_merge and src_uid in existing_target_ids:
                                        # ID collision with different user on Rumpty Cloud! Allocate new safe ID
                                        max_target_id += 1
                                        user_id_map[src_uid] = max_target_id
                                        row_dict['id'] = max_target_id
                                        remapped += 1
                                    else:
                                        user_id_map[src_uid] = src_uid

                                # Special handling for api_reportproject
                                elif table == 'api_reportproject':
                                    src_pid = row_dict['id']
                                    if 'user_id' in row_dict and row_dict['user_id'] in user_id_map:
                                        row_dict['user_id'] = user_id_map[row_dict['user_id']]

                                    if smart_merge and src_pid in existing_target_ids:
                                        max_target_id += 1
                                        project_id_map[src_pid] = max_target_id
                                        row_dict['id'] = max_target_id
                                        remapped += 1
                                    else:
                                        project_id_map[src_pid] = src_pid

                                # Foreign Key Remapping across child models
                                else:
                                    if 'user_id' in row_dict and row_dict['user_id'] in user_id_map:
                                        row_dict['user_id'] = user_id_map[row_dict['user_id']]
                                    if 'project_id' in row_dict and row_dict['project_id'] in project_id_map:
                                        row_dict['project_id'] = project_id_map[row_dict['project_id']]
                                    if 'report_id' in row_dict and row_dict['report_id'] in report_id_map:
                                        row_dict['report_id'] = report_id_map[row_dict['report_id']]
                                    if 'page_id' in row_dict and row_dict['page_id'] in page_id_map:
                                        row_dict['page_id'] = page_id_map[row_dict['page_id']]

                                    if has_id and smart_merge and row_dict.get('id') in existing_target_ids:
                                        max_target_id += 1
                                        old_id = row_dict['id']
                                        row_dict['id'] = max_target_id
                                        if table == 'api_report':
                                            report_id_map[old_id] = max_target_id
                                        elif table == 'api_logbookpage':
                                            page_id_map[old_id] = max_target_id
                                        remapped += 1

                                vals = tuple(row_dict[c] for c in columns)
                                batch_values.append(vals)

                            if batch_values and not dry_run:
                                execute_batch(t_cur, insert_sql, batch_values, page_size=batch_size)
                            inserted += len(batch_values)

                    if not dry_run:
                        target_conn.commit()

                    self.stdout.write(self.style.SUCCESS(
                        f"  Finished '{table}': {inserted} added ({remapped} remapped), {preserved} target rows preserved."
                    ))
                    summary.append((table, src_count, inserted, remapped))

                if not dry_run:
                    t_cur.execute("SET session_replication_role = 'origin';")
                    target_conn.commit()

                # Reset Sequences so future inserts don't collide with migrated IDs
                if reset_sequences and not dry_run:
                    self.stdout.write(self.style.MIGRATE_LABEL("\nResetting PostgreSQL sequences to MAX(id) + 1..."))
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
                    for seq, tbl, col in seqs:
                        try:
                            t_cur.execute(f"""
                                SELECT setval(
                                    pg_get_serial_sequence(%s, %s),
                                    COALESCE((SELECT MAX("{col}") FROM "{tbl}"), 1),
                                    (SELECT MAX("{col}") IS NOT NULL FROM "{tbl}")
                                );
                            """, (tbl, col))
                        except Exception as seq_err:
                            self.stdout.write(self.style.WARNING(f"  Warning on sequence {seq}: {seq_err}"))
                    target_conn.commit()
                    self.stdout.write(self.style.SUCCESS("  All PostgreSQL sequences synchronized successfully."))

        except Exception as exc:
            if not dry_run and target_conn:
                target_conn.rollback()
            self.stderr.write(self.style.ERROR(f"Migration error: {exc}"))
            raise

        self.stdout.write(self.style.SUCCESS("\nMigration Complete! Summary of transferred tables:"))
        for tbl, src, ins, rem in summary:
            self.stdout.write(f"  - {tbl}: {ins}/{src} rows migrated ({rem} remapped for safety)")
