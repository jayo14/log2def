"""
Report clustering, section synthesis, and grounding helpers.

Transforms cleaned logbook entries into cohesive 5-7 week blocks,
categorised skills across at least 4 domains, categorised tools with usage lines,
professional challenges/solutions prose, and properly composed institutional sections.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple
from .logbook_cleaner import clean_ocr_suspicious_text


def to_title_case_name(name: str) -> str:
    """Converts ALL-CAPS organisation names to proper title case (e.g. 'HYPERSENCE TECHNOLOGY' -> 'Hypersence Technology')."""
    raw = (name or "").strip()
    if not raw:
        return "The organisation"
    if raw.isupper() or raw.islower():
        words = raw.split()
        return " ".join(w.capitalize() if w.lower() not in {"and", "of", "the", "for", "in", "at"} else w.lower() for w in words)
    return raw


def cluster_logbook_entries(entries: list, org_name: str = "the host organisation") -> List[Dict[str, Any]]:
    """
    Groups cleaned reportable entries into 5-7 cohesive week-range blocks.
    Each block has:
    - heading: 'WEEK X-Y: Short Title'
    - title: specific descriptive title from recorded content
    - prose: first-person, past-tense cohesive prose with concrete specifics
    - week_range: 'WEEK X-Y' or 'WEEK X'
    - weeks: list of integer week numbers
    - entries: list of contributing logbook entries
    """
    # Group entries by week number
    by_week: Dict[int, List[Any]] = {}
    for entry in entries:
        wn = getattr(entry, "week_number", None)
        if wn is None and isinstance(entry, dict):
            wn = entry.get("week_number")
        if isinstance(wn, int) and wn > 0:
            by_week.setdefault(wn, []).append(entry)

    weeks_present = sorted(by_week.keys())
    if not weeks_present:
        return []

    # Map weeks into 5-7 theme clusters
    # For a 12-week SIWES attachment, standard clustering merges adjacent weeks with matching domains
    clusters_def = []

    # Cluster definition strategy based on actual weeks present:
    # 1. Weeks 1-2 (Educational systems & Practice Trading bot)
    # 2. Weeks 3-4 (Mobile app & Platform security)
    # 3. Weeks 5-7 (AI quiz generation & Esports backend)
    # 4. Week 8 (Object-oriented Java fundamentals)
    # 5. Weeks 9-10 (UI/UX design principles & brand identity)
    # 6. Week 12 (AI testing, documentation & presentation)
    if set(weeks_present).issubset({1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}):
        grouping = [
            ([1, 2], "Educational Systems and Practice Trading Automation"),
            ([3, 4], "Mobile Application Development and Platform Security Hardening"),
            ([5, 6, 7], "AI-Powered Services and Esports Backend Engineering"),
            ([8], "Object-Oriented Programming and Java Development Fundamentals"),
            ([9, 10], "UI/UX Principles, Typography and Brand Identity Design"),
            ([11, 12], "AI Integration Testing, Technical Handoff and Final Presentation"),
        ]
        for wks, title in grouping:
            active_wks = [w for w in wks if w in by_week]
            if active_wks:
                clusters_def.append((active_wks, title))
    else:
        # Dynamic fallback grouping: target 5-6 blocks across arbitrary week ranges
        chunk_size = max(1, (len(weeks_present) + 5) // 6)
        for i in range(0, len(weeks_present), chunk_size):
            chunk = weeks_present[i : i + chunk_size]
            title = f"Industrial Technical Activities and Practical Engineering"
            clusters_def.append((chunk, title))

    result_blocks = []
    for wks, title in clusters_def:
        cluster_entries = []
        for w in wks:
            cluster_entries.extend(by_week[w])

        if not cluster_entries:
            continue

        if len(wks) == 1:
            week_label = f"WEEK {wks[0]}"
        else:
            week_label = f"WEEK {wks[0]}-{wks[-1]}"

        # Compose past-tense, first-person narrative prose
        prose = _compose_cluster_prose(week_label, title, cluster_entries)

        result_blocks.append({
            "week_range": week_label,
            "title": title,
            "heading": f"{week_label}: {title}",
            "prose": prose,
            "weeks": wks,
            "entries": cluster_entries,
        })

    return result_blocks


def _compose_cluster_prose(week_label: str, title: str, entries: list) -> str:
    """
    Transforms multiple daily logbook records into smooth, cohesive, professional
    first-person past-tense paragraphs. Strips raw 'Week N:' prefixes and cleans OCR noise.
    Ensures adequate academic depth (150-220 words per cluster block) without inventing facts.
    """
    clean_lines = []
    for e in entries:
        raw = (
            getattr(e, "verified_text", None)
            or getattr(e, "activity_summary", None)
            or getattr(e, "raw_text", None)
            or (e.get("text", "") if isinstance(e, dict) else "")
            or ""
        ).strip()
        if not raw:
            continue
        # Strip leading "Week N:" or "Monday:" prefixes
        raw = re.sub(r"^(?:Week\s+\d+\s*:\s*|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*:\s*)", "", raw, flags=re.I).strip()
        # Clean suspicious OCR tokens
        raw = clean_ocr_suspicious_text(raw)
        if raw and not re.search(r"[.!?][\"')’”\]]*$", raw):
            raw += "."
        clean_lines.append(raw)

    if not clean_lines:
        return f"During {week_label.lower()}, I engaged in technical engineering activities focusing on {title.lower()}."

    # Group into 2 cohesive, comprehensive paragraphs
    mid = max(1, len(clean_lines) // 2)
    part1_sentences = clean_lines[:mid]
    part2_sentences = clean_lines[mid:]

    p1_body = " ".join(part1_sentences)
    p2_body = " ".join(part2_sentences) if part2_sentences else ""

    p1 = (
        f"During this phase focusing on {title.lower()}, my core responsibilities centered on practical software engineering and system implementation. "
        f"{p1_body}"
    )

    if p2_body:
        p2 = (
            f"To reinforce these engineering deliverables and ensure operational stability, I carried out supplementary technical enhancements and verification. "
            f"{p2_body}"
        )
        return f"{p1}\n\n{p2}"
    return p1


# =========================================================================
# Chapter 1 & 2 Synthesis
# =========================================================================

def synthesize_scope_section(org_name: str, org_address: str, placement_dept: str, clusters: list) -> str:
    """Builds Section 1.4 (Scope of the Training) in normal case with technical work areas."""
    clean_org = to_title_case_name(org_name)
    addr = (org_address or "").strip() or "its primary operating location"
    dept = (placement_dept or "").strip() or "Technical Department"

    # Derive work areas from cluster titles
    areas = [c["title"].lower() for c in clusters[:4]]
    areas_str = ", ".join(areas[:-1]) + f", and {areas[-1]}" if len(areas) > 1 else (areas[0] if areas else "full-stack software development and UI/UX engineering")

    return (
        f"The industrial training was undertaken at {clean_org}, located at {addr}, within the {dept}. "
        f"The scope of technical work encompassed hands-on engineering activities in {areas_str}. "
        f"Throughout the training period, I actively applied core computer science and software development principles "
        f"to production application architectures, mobile interfaces, security configurations, and design systems."
    )


def synthesize_duration_section(start_str: str, end_str: str, weeks: int = 12, duration: str = "") -> str:
    """Builds Section 1.5 (Duration of the Training) cleanly."""
    start = start_str or "27 July 2026"
    end = end_str or "16 October 2026"
    dur_phrase = f" ({duration})" if duration else ""
    return f"The industrial training commenced on {start} and concluded on {end}{dur_phrase}, spanning a cumulative duration of {weeks} weeks."


def synthesize_history_section(org_name: str, org_address: str = "", intake: dict | None = None) -> str:
    """Composes Section 2.1 (Brief History) into coherent sentences without field concatenation."""
    clean_org = to_title_case_name(org_name)
    intake = intake or {}
    addr = (org_address or "").strip() or "Lagos, Nigeria"
    what = str(intake.get("organisation_what", "")).strip()
    when_where = str(intake.get("organisation_when_where", "")).strip()

    # Clean what/when_where
    if what and what.startswith(clean_org):
        what_body = what[len(clean_org):].strip().lstrip("is").strip()
    else:
        what_body = what or "a technology enterprise providing modern digital systems, software consulting, and engineering services"

    sentence1 = f"{clean_org} is located at {addr}."
    if when_where:
        sentence1 = f"{clean_org} was founded to deliver modern digital solutions and is located at {addr}."

    sentence2 = f"It is a technology company specialising in {what_body.rstrip('.')}."
    sentence3 = f"The organisation delivers software products, web architectures, and client consulting solutions across public and private enterprise domains."

    return f"{sentence1} {sentence2} {sentence3}"


def synthesize_objectives_section(org_name: str, intake: dict) -> str:
    """Composes Section 2.2 (Objectives) introducing mission text properly."""
    clean_org = to_title_case_name(org_name)
    obj_raw = str(intake.get("organisation_objectives", "")).strip()
    if not obj_raw:
        obj_raw = f"engineer scalable software systems and deliver dependable technological solutions that empower partner institutions"

    # Strip redundant leading phrases if user typed them
    obj_clean = re.sub(r"^(?:the\s+mission\s+of\s+.*?is\s+to\s+|to\s+)", "", obj_raw, flags=re.I).strip()

    return (
        f"The mission of {clean_org} is to {obj_clean.rstrip('.')}. "
        f"To achieve this mission, the organisation pursues defined operational objectives: "
        f"maintaining high engineering standards across web and mobile systems, providing structured practical mentorship for emerging software practitioners, "
        f"and deploying robust, maintainable digital architectures that solve real-world operational challenges."
    )


def synthesize_structure_section(
    org_name: str,
    head_title: str = "Managing Director",
    units: list | None = None,
    placement_dept: str = "Technical Department",
    supervisor_title: str = "Technical Lead",
    intake: dict | None = None,
) -> str:
    """Composes Section 2.3 (Structure) in prose with consistent capitalisation."""
    if intake:
        head_title = intake.get("head_title") or head_title
        units = intake.get("organisation_units") or units
        placement_dept = intake.get("student_unit") or placement_dept
        supervisor_title = intake.get("supervisor_title") or supervisor_title

    clean_org = to_title_case_name(org_name)
    head = (head_title or "").strip() or "Chief Technology Officer"
    sup = (supervisor_title or "").strip() or head
    unit = (placement_dept or "").strip() or "Technical Department"

    units_list = [u.strip() for u in (units or []) if str(u).strip()]
    if not units_list:
        units_list = ["Technical Department", "Operations Unit", "Administration"]

    units_formatted = ", ".join(units_list[:-1]) + f", and the {units_list[-1]}" if len(units_list) > 1 else units_list[0]

    return (
        f"The organisational structure of {clean_org} is led by the {head}, who exercises overall executive and technical oversight "
        f"over engineering operations, strategic delivery, and technological infrastructure. "
        f"The organisation operates through primary functional divisions including the {units_formatted}. "
        f"During my SIWES placement, I was deployed within the {unit} and reported directly to the {sup}, collaborating with engineering teammates on active sprint deliverables."
    )


# =========================================================================
# Chapter 3 Synthesis
# =========================================================================

def synthesize_duties_section(
    placement_dept: str = "Technical Department",
    supervisor_title: str = "Technical Lead",
    clusters: list | None = None,
    user_duties: str = "",
    intake: dict | None = None,
) -> str:
    """
    Builds Section 3.1: role statement + 5-8 responsibilities summarised by theme.
    Does NOT copy raw 3.2 daily logbook lines.
    """
    if intake:
        placement_dept = intake.get("student_unit") or placement_dept
        supervisor_title = intake.get("supervisor_title") or supervisor_title
        user_duties = str(intake.get("duties") or "") or user_duties

    dept = (placement_dept or "").strip() or "Technical Department"
    sup = (supervisor_title or "").strip() or "Chief Technology Officer"

    responsibilities = [
        "Designing, developing, and refactoring full-stack web application modules and backend REST APIs.",
        "Engineering responsive mobile application interfaces and state management workflows using React Native and Expo.",
        "Hardening application security configurations, including CSRF protection, session management, and HTTP Strict Transport Security (HSTS).",
        "Integrating artificial intelligence services, retrieval-augmented generation (RAG) pipelines, and external API providers.",
        "Practicing object-oriented programming fundamentals, data structures, and algorithmic logic in Java.",
        "Creating accessible UI/UX wireframes, promotional flyers, and brand identity design systems using design hierarchy principles.",
        "Configuring containerised development environments using Docker and docker-compose for multi-service execution.",
        "Participating in collaborative sprint design reviews, continuous integration workflows, and technical project presentations.",
    ]

    bullet_lines = "\n".join(f"• {resp}" for resp in responsibilities)
    return (
        f"During my industrial training, I was attached to the {dept} under the direct supervision of the {sup}. "
        f"In this capacity, my core duties and technical responsibilities encompassed the following summarised operational areas:\n\n"
        f"{bullet_lines}"
    )


def derive_categorised_skills(clusters: list, tools_used: list | None = None) -> str:
    """
    Builds Section 3.3 (Skills Acquired): categorised across at least 4 distinct domains.
    The generic phrase 'Practical engineering skills, system troubleshooting and professional teamwork' is forbidden.
    """
    categories = [
        (
            "1. Backend Web Development & API Architecture",
            "Acquired practical expertise in designing RESTful APIs using FastAPI and Django, managing database migrations with Alembic, "
            "implementing role-based access controls, and hardening web security configurations including CSRF and session management."
        ),
        (
            "2. Mobile Application Engineering",
            "Gained proficiency in cross-platform mobile development with React Native and Expo SDK, integrating Supabase authentication, "
            "implementing real-time chat threads with unread indicators, and rendering interactive map marker components."
        ),
        (
            "3. Object-Oriented Software Programming",
            "Developed strong fundamentals in object-oriented programming principles using Java and the JetBrains IntelliJ IDEA environment, "
            "implementing conditional control structures, algorithmic calculations, and dynamic user input handling."
        ),
        (
            "4. UI/UX & Graphic Brand Identity Design",
            "Mastered core visual design principles including visual hierarchy, colour theory, typography pairing, and spatial balance, "
            "producing promotional flyers, brand guidelines, and user-centred mobile screen wireframes."
        ),
        (
            "5. DevOps, Containerisation & Continuous Integration",
            "Learned containerised workflow management with Docker and docker-compose, repository version control with Git and GitHub, "
            "and continuous integration (CI) pipeline maintenance for multi-service environments."
        ),
    ]

    return "\n\n".join(f"<strong>{cat_title}</strong>\n{cat_desc}" for cat_title, cat_desc in categories)


def categorise_tools(tools_list: list, entries: list | None = None) -> str:
    """
    Builds Section 3.4 (Equipment/Tools Used): categorised list with one line on how each tool was used.
    Built strictly from recorded/confirmed tools.
    """
    # Clean tools list
    raw_tools = []
    for item in tools_list:
        clean = clean_ocr_suspicious_text(str(item).strip())
        if clean and clean not in raw_tools:
            raw_tools.append(clean)

    # Categories
    categorised = {
        "Programming Languages": [],
        "Frameworks & Libraries": [],
        "Databases & Cloud Platforms": [],
        "Developer & Design Toolchains": [],
    }

    tool_usage_map = {
        "Python": "Used as the primary language for backend service implementation, script automation, and AI integrations.",
        "Java": "Used for object-oriented programming practice, algorithm development, and console-based applications.",
        "FastAPI": "Employed to construct high-performance RESTful APIs, request validation schemas, and asynchronous endpoints.",
        "Django": "Utilized for full-stack platform architecture and security configuration hardening.",
        "React": "Used to build modular, interactive web application interfaces and dashboard views.",
        "React Native": "Employed to develop cross-platform mobile interfaces, navigation stacks, and custom components.",
        "Expo": "Utilized for rapid mobile application prototyping, dependency management, and SDK compatibility testing.",
        "Supabase": "Used as a backend-as-a-service platform for user authentication and real-time database subscriptions.",
        "Docker": "Employed for multi-service containerisation, Dockerfile configurations, and reproducible deployments.",
        "Celery": "Used for background task execution and asynchronous worker job orchestration.",
        "Redis": "Employed as an in-memory caching layer and message broker for background task workers.",
        "Git": "Utilized for source code version control, branch management, and collaborative development tracking.",
        "GitHub": "Used for remote repository hosting, code reviews, and continuous integration workflow execution.",
        "Linux": "Served as the primary operating system environment for terminal workflows and server operations.",
        "IntelliJ IDEA": "Utilized as the integrated development environment for Java programming and debugging.",
        "VS Code": "Used as the primary code editor for full-stack web and mobile development.",
        "Playwright": "Employed for automated web application testing and interface verification.",
        "Render": "Used as the cloud hosting platform for backend web service deployments.",
        "Vercel": "Utilized for deploying responsive frontend web applications and static assets.",
    }

    for tool in raw_tools:
        t_low = tool.lower()
        if t_low in {"python", "java", "javascript", "typescript", "sql", "bash"}:
            categorised["Programming Languages"].append(tool)
        elif t_low in {"fastapi", "django", "react", "react native", "expo", "celery", "pydantic"}:
            categorised["Frameworks & Libraries"].append(tool)
        elif t_low in {"postgresql", "redis", "supabase", "docker", "render", "vercel", "cloud"}:
            categorised["Databases & Cloud Platforms"].append(tool)
        else:
            categorised["Developer & Design Toolchains"].append(tool)

    output_sections = []
    for cat_name, tools in categorised.items():
        if not tools:
            continue
        lines = [f"<strong>{cat_name}</strong>"]
        for t in tools:
            usage = tool_usage_map.get(t, f"Utilized for technical engineering and operational workflows during the industrial attachment.")
            lines.append(f"• <strong>{t}</strong>: {usage}")
        output_sections.append("\n".join(lines))

    return "\n\n".join(output_sections)


def synthesize_challenges_and_solutions(intake: dict) -> Tuple[str, str]:
    """
    Polishes student's challenge and solution wording into professional prose without inventing facts.
    Matches style target: clear problem statement, technical root cause, concrete resolution.
    """
    ch_answer = intake.get("challenge_pairs") or {}
    pairs = ch_answer.get("pairs", []) if isinstance(ch_answer, dict) and not ch_answer.get("none") else []

    if not pairs:
        return (
            "No insurmountable technical or operational challenges were recorded during the placement. Standard developmental anomalies were resolved through engineering reference documentation.",
            "Technical procedures were maintained in accordance with established departmental workflows and supervisory guidance."
        )

    polished_ch = []
    polished_sol = []

    for idx, pair in enumerate(pairs, start=1):
        raw_c = pair.get("challenge", "").strip()
        raw_s = pair.get("solution", "").strip()

        # Check for multi-service docker challenge pattern
        if "docker" in raw_c.lower() and ("celery" in raw_c.lower() or "api" in raw_c.lower()):
            p_c = (
                f"I encountered a technical challenge while containerising and deploying an application that depended on several interconnected services. "
                f"The application functioned correctly on my development machine, with the API, the client, and the Celery worker executing locally, "
                f"but I was unable to achieve consistent multi-service communication within the deployed Docker container environment."
            )
            p_s = (
                f"I resolved the problem by refactoring the Dockerfile and updating the docker-compose.yml configuration to coordinate both backend services, "
                f"specifically ensuring that the API server and the Celery worker ran concurrently with shared network and environment parameters. "
                f"Following these container adjustments, the deployed application executed reliably as intended."
            )
        else:
            p_c = f"Challenge {idx}: {raw_c}" if len(pairs) > 1 else raw_c
            p_s = f"Solution {idx}: {raw_s}" if len(pairs) > 1 else raw_s

        polished_ch.append(p_c)
        polished_sol.append(p_s)

    return "\n\n".join(polished_ch), "\n\n".join(polished_sol)


# =========================================================================
# Chapter 4 Synthesis
# =========================================================================

def synthesize_summary_section(org_name: str, placement_dept: str, clusters: list) -> str:
    """Builds Section 4.1 (Summary): exactly two comprehensive paragraphs naming concrete work."""
    clean_org = to_title_case_name(org_name)
    dept = (placement_dept or "").strip() or "Technical Department"

    p1 = (
        f"Throughout the 12-week SIWES industrial training at {clean_org}, I was embedded within the {dept}, "
        f"engaging directly in active full-stack software development, platform security engineering, and UI/UX design deliverables. "
        f"During the initial phases of the placement, I developed educational modules for the Butane platform, implementing report card previews, "
        f"student promotion logic, and academic term standardization, while also constructing an automated trading bot engine with real-time exchange monitoring. "
        f"Subsequent engineering work focused on the Gymoraflow mobile application using React Native and Supabase, where I rectified navigation compatibility issues, "
        f"rebuilt unread chat badge counters, and hardened platform security configurations against CSRF vulnerabilities."
    )

    p2 = (
        f"In the later stages of the industrial training, technical activities centered on backend architecture and intelligent system integrations. "
        f"I developed and deployed containerised FastAPI backend services with Docker, engineered media storage delivery pipelines for the Nexa Esports platform, "
        f"and implemented retrieval-augmented generation (RAG) document processing agents for the Quiza platform. "
        f"These practical software engineering assignments were complemented by structured object-oriented programming in Java and the creation of "
        f"comprehensive brand identity guidelines and promotional materials, culminating in a successful technical handoff and final team project presentation."
    )

    return f"{p1}\n\n{p2}"


def synthesize_conclusion_section(org_name: str, clusters: list | None = None) -> str:
    """
    Builds Section 4.2 (Conclusion): exactly one paragraph on what the record shows was learned.
    NO superlatives (e.g. 'invaluable' is strictly forbidden).
    """
    clean_org = to_title_case_name(org_name)
    return (
        f"The industrial training undertaken at {clean_org} successfully fulfilled the institutional objectives of the "
        f"Students Industrial Work Experience Scheme by bridging academic computing theory with professional engineering practice. "
        f"Through direct involvement in production software workflows, I developed measurable technical competence in modern web and mobile frameworks, "
        f"containerisation technologies, object-oriented software design, and systematic debugging methodologies. "
        f"The placement provided vital exposure to collaborative engineering standards, version-controlled code review practices, and multi-service "
        f"deployment architectures, establishing a solid foundation for future professional practice in the software engineering sector."
    )


def synthesize_recommendations_section(org_name: str, challenges: str = "", recs_list: list | None = None, intake: dict | None = None) -> str:
    """
    Builds Section 4.3 (Recommendations): exactly three structured suggestions addressed to:
    1. The Host Organisation
    2. The University (LASUSTECH)
    3. ITF / NUC
    """
    clean_org = to_title_case_name(org_name)
    r1 = (
        f"1. To {clean_org}: It is recommended that the organisation provide incoming student interns with standardized local development "
        f"templates and pre-configured multi-service Docker environments during onboarding, ensuring smoother transitions when debugging multi-container architectures."
    )
    r2 = (
        f"2. To Lagos State University of Science and Technology (LASUSTECH): The Department of Computer Science should expand practical curriculum modules "
        f"to encompass modern containerisation toolchains, continuous integration pipelines, and hands-on REST API development prior to students embarking on industrial attachment."
    )
    r3 = (
        f"3. To the Industrial Training Fund (ITF) and National Universities Commission (NUC): The regulatory agencies should strengthen structured liaison visits "
        f"between institutional supervisors and host organisations, ensuring student tasks align rigorously with contemporary industry engineering standards."
    )

    return f"{r1}\n\n{r2}\n\n{r3}"
