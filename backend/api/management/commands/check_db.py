import time
from django.core.management.base import BaseCommand
from django.db import connection, connections
from django.db.migrations.recorder import MigrationRecorder


class Command(BaseCommand):
    help = "Diagnoses database connectivity, server version, SSL mode, applied migrations, and table metrics."

    def add_arguments(self, parser):
        parser.add_argument(
            '--database',
            default='default',
            help='Database connection alias to check (default: default)',
        )

    def handle(self, *args, **options):
        db_alias = options['database']
        self.stdout.write(self.style.MIGRATE_HEADING(f"Checking database connection for '{db_alias}'..."))

        conn = connections[db_alias]
        t0 = time.perf_counter()
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT version();")
                pg_version = cursor.fetchone()[0]

                cursor.execute("SELECT current_database(), current_user;")
                db_name, db_user = cursor.fetchone()

                ssl_used = "Unknown"
                try:
                    cursor.execute("SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid();")
                    ssl_row = cursor.fetchone()
                    if ssl_row:
                        ssl_used = f"{ssl_row[0]} (protocol: {ssl_row[1]}, cipher: {ssl_row[2]})"
                except Exception:
                    pass

                cursor.execute("""
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                    ORDER BY table_name;
                """)
                tables = [row[0] for row in cursor.fetchall()]

                table_stats = []
                for table in tables:
                    cursor.execute(f'SELECT count(*) FROM "{table}";')
                    cnt = cursor.fetchone()[0]
                    table_stats.append((table, cnt))

            elapsed_ms = (time.perf_counter() - t0) * 1000
            self.stdout.write(self.style.SUCCESS(f"Connected successfully in {elapsed_ms:.1f}ms!"))
            self.stdout.write(f"  Database: {db_name}")
            self.stdout.write(f"  User:     {db_user}")
            self.stdout.write(f"  SSL Used: {ssl_used}")
            self.stdout.write(f"  Version:  {pg_version.split(',')[0]}")
            self.stdout.write(f"  Tables:   {len(tables)} public tables found")

            # Check migrations
            recorder = MigrationRecorder(conn)
            applied = recorder.applied_migrations()
            self.stdout.write(f"  Applied Migrations: {len(applied)}")

            self.stdout.write(self.style.MIGRATE_LABEL("\nTable Statistics:"))
            for table, count in table_stats:
                self.stdout.write(f"  - {table}: {count} row(s)")

        except Exception as exc:
            self.stderr.write(self.style.ERROR(f"Database connection failed: {exc}"))
            raise
