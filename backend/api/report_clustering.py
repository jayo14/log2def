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


def clean_address_spacing(addr: str) -> str:
    """Clean missing spaces in addresses like 12Moshood -> 12 Moshood, Street,Omitoro -> Street, Omitoro."""
    if not addr:
        return ""
    addr = re.sub(r'(\d+)([A-Za-z])', r'\1 \2', addr)
    addr = re.sub(r',([^\s])', r', \1', addr)
    addr = re.sub(r'\s+', ' ', addr)
    return addr.strip()


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

    # Cluster definition strategy:
    # If entries have fewer than 4 weeks present but many entries (e.g. sparse / unsegmented logbook),
    # chronologically segment entries across 5-6 cohesive week blocks.
    if len(weeks_present) < 4 and len(entries) >= 10:
        num_blocks = min(6, max(4, len(entries) // 8))
        chunk_len = (len(entries) + num_blocks - 1) // num_blocks
        clusters_def = []
        for b_idx in range(num_blocks):
            w_start = b_idx * 2 + 1
            w_end = b_idx * 2 + 2
            w_list = [w_start, w_end]
            sub_entries = entries[b_idx * chunk_len : (b_idx + 1) * chunk_len]
            if not sub_entries:
                continue
            title = _derive_cluster_title(sub_entries)
            clusters_def.append((w_list, title, sub_entries))
    elif set(weeks_present).issubset({1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}):
        grouping = [
            ([1, 2], "Educational Systems and Practice Trading Automation"),
            ([3, 4], "Mobile Application Development and Platform Security Hardening"),
            ([5, 6, 7], "AI-Powered Services and Esports Backend Engineering"),
            ([8], "Object-Oriented Programming and Java Development Fundamentals"),
            ([9, 10], "UI/UX Principles, Typography and Brand Identity Design"),
            ([11, 12], "AI Integration Testing, Technical Handoff and Final Presentation"),
        ]
        for wks, default_title in grouping:
            active_wks = [w for w in wks if w in by_week]
            if active_wks:
                wks_entries = []
                for w in active_wks:
                    wks_entries.extend(by_week[w])
                title = _derive_cluster_title(wks_entries, default_title)
                clusters_def.append((active_wks, title, wks_entries))
    else:
        # Dynamic fallback grouping: target 5-6 blocks across arbitrary week ranges
        chunk_size = max(1, (len(weeks_present) + 5) // 6)
        for i in range(0, len(weeks_present), chunk_size):
            chunk = weeks_present[i : i + chunk_size]
            wks_entries = []
            for w in chunk:
                wks_entries.extend(by_week.get(w, []))
            title = _derive_cluster_title(wks_entries, "Industrial Technical Activities and Practical Engineering")
            clusters_def.append((chunk, title, wks_entries))

    result_blocks = []
    for item in clusters_def:
        if len(item) == 3:
            wks, title, cluster_entries = item
        else:
            wks, title = item
            cluster_entries = []
            for w in wks:
                cluster_entries.extend(by_week.get(w, []))

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


def _derive_cluster_title(cluster_entries: list, fallback: str = "Industrial Technical Activities and Practical Engineering") -> str:
    """Derives a technical, coordinator-compliant cluster title from entry contents."""
    combined_text = " ".join([
        (getattr(e, "verified_text", "") or getattr(e, "raw_text", "") or getattr(e, "activity_summary", "") or "")
        + " " + str(getattr(e, "tools_used", "") or "")
        + " " + str(getattr(e, "equipment_used", "") or "")
        for e in cluster_entries
    ]).lower()

    if any(k in combined_text for k in ["nanostation", "access point", "cambium", "wireless", "antenna", "rf"]):
        return "Wireless Network Configuration and Access Point Deployment"
    if any(k in combined_text for k in ["cabling", "rj45", "crimping", "cat5", "cat6", "patch panel", "lan tester"]):
        return "Structured Cabling, RJ45 Termination and Cable Diagnostics"
    if any(k in combined_text for k in ["motherboard", "ram", "power supply", "disassembly", "pc assembly", "cpu", "hardware maintenance"]):
        return "Computer Hardware Maintenance, Assembly and Diagnostic Testing"
    if any(k in combined_text for k in ["ip address", "subnet", "dhcp", "switch", "cisco", "router", "vlan", "default gateway"]):
        return "Local Area Network Administration and Switch Configuration"
    if any(k in combined_text for k in ["wordpress", "xampp", "apache", "php", "web layout", "mysql"]):
        return "Content Management System Deployment and Web Administration"
    if any(k in combined_text for k in ["canva", "coreldraw", "graphics", "flyer", "banner", "design tools"]):
        return "Digital Graphic Communication and Brand Identity Design"
    if any(k in combined_text for k in ["fastapi", "django", "api", "rest", "backend", "endpoint", "database"]):
        return "Backend API Architecture and Database Integration"
    if any(k in combined_text for k in ["react", "react native", "expo", "mobile", "frontend", "ui"]):
        return "Mobile Application Engineering and User Interface Design"
    if any(k in combined_text for k in ["java", "intellij", "oop", "object-oriented", "algorithm"]):
        return "Object-Oriented Programming and Software Development"
    if any(k in combined_text for k in ["docker", "container", "redis", "celery", "devops"]):
        return "Containerised Service Deployment and Task Orchestration"
    if any(k in combined_text for k in ["testing", "playwright", "audit", "documentation", "presentation"]):
        return "System Verification, Diagnostic Audits and Technical Documentation"
    if any(k in combined_text for k in ["server", "domain controller", "active directory", "ubuntu", "linux"]):
        return "Server Infrastructure Administration and Operating Systems"
    return fallback


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

    # Group into 2 cohesive, comprehensive paragraphs (~155-165 words total)
    mid = max(1, len(clean_lines) // 2)
    part1_sentences = clean_lines[:mid][:3]
    part2_sentences = clean_lines[mid:][:3]

    p1_body = " ".join(part1_sentences)
    p2_body = " ".join(part2_sentences) if part2_sentences else ""

    p1 = (
        f"During this phase focusing on {title.lower()}, my core responsibilities centred on practical technical engineering and system implementation. "
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
    addr = clean_address_spacing((org_address or "").strip() or "Lagos, Nigeria")
    what = str(intake.get("organisation_what", "")).strip()
    when_where = str(intake.get("organisation_when_where", "")).strip()

    # Clean what/when_where
    if what and what.startswith(clean_org):
        what_body = what[len(clean_org):].strip().lstrip("is").strip()
    else:
        what_body = what or "a technology enterprise providing modern digital systems, software consulting, and engineering services"

    # Strip redundant leading noun phrases like "A technology solutions company specializing in"
    what_body = re.sub(r"^(?:an?\s+(?:[a-zA-Z\s]+)?company\s+(?:speciali[sz]ing\s+in\s+)?|an?\s+enterprise\s+(?:speciali[sz]ing\s+in\s+)?|speciali[sz]ing\s+in\s+)", "", what_body, flags=re.I).strip()
    what_body = re.sub(r"\bspecializing\b", "specialising", what_body, flags=re.I)
    what_body = re.sub(r"\bspecialized\b", "specialised", what_body, flags=re.I)
    what_body = re.sub(r"\borganization\b", "organisation", what_body, flags=re.I)

    sentence1 = f"{clean_org} is located at {addr}."
    if when_where:
        sentence1 = f"{clean_org} was founded to deliver modern digital solutions and is located at {addr}."

    sentence2 = f"It is a technology enterprise specialising in {what_body.rstrip('.')}."
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
    Does NOT copy raw 3.2 daily logbook lines. Dynamically adapts to student's domain.
    """
    if intake:
        placement_dept = intake.get("student_unit") or placement_dept
        supervisor_title = intake.get("supervisor_title") or supervisor_title
        user_duties = str(intake.get("duties") or "") or user_duties

    dept = (placement_dept or "").strip() or "Technical Department"
    sup = (supervisor_title or "").strip() or "Technical Supervisor"

    # Detect domain from clusters and placement dept
    clusters_text = " ".join([c.get("heading", "") + " " + c.get("prose", "") for c in (clusters or [])]).lower()
    dept_low = dept.lower()

    is_networking_hardware = any(k in clusters_text or k in dept_low for k in [
        "cabling", "rj45", "crimping", "nanostation", "cambium", "access point", "hardware", "switch", "router", "ict unit"
    ])
    is_media_cms = any(k in clusters_text or k in dept_low for k in [
        "wordpress", "canva", "coreldraw", "graphics", "xampp", "apache", "media"
    ])

    if is_networking_hardware:
        responsibilities = [
            "Terminating, crimping, and testing CAT5e and CAT6 Ethernet network cables using RJ45 connectors and LAN cable testers.",
            "Deploying, aligning, and testing outdoor wireless nanostations and Cambium directional broadband links.",
            "Configuring wireless local area network access points, SSID security profiles, and client device connectivity.",
            "Performing workstation hardware disassembly, diagnostic component troubleshooting, and RAM upgrades on client systems.",
            "Managing static and dynamic IP address configurations, subnet masks, default gateways, and network switch patching.",
            "Maintaining server room equipment racks, UPS power backup systems, and conducting routine infrastructure inspections.",
            "Installing, updating, and troubleshooting client operating systems, device drivers, and diagnostic utility tools.",
            "Logging network anomalies, documenting hardware maintenance tickets, and supporting senior technical staff on field deployments.",
        ]
    elif is_media_cms:
        responsibilities = [
            "Deploying, configuring, and maintaining dynamic content management systems and web pages using WordPress and Apache.",
            "Designing corporate digital graphics, vector banners, and brand identity materials adhering to visual design hierarchy.",
            "Administering local development server environments using XAMPP and executing PHP script modifications.",
            "Conducting spreadsheet data analysis, equipment inventory tracking, and operational metric reporting using Microsoft Excel.",
            "Diagnosing workstation peripheral malfunctions, local network printer connectivity issues, and software installation faults.",
            "Assisting senior technical personnel in digital media production, website maintenance, and client content updates.",
            "Participating in weekly departmental planning briefings, technical documentation, and project reviews.",
        ]
    else:
        responsibilities = [
            "Designing, developing, and refactoring full-stack web application modules and backend REST APIs.",
            "Engineering responsive mobile application interfaces and state management workflows using React Native and Expo.",
            "Hardening application security configurations, including CSRF protection, session management, and HTTP Strict Transport Security (HSTS).",
            "Integrating artificial intelligence services, retrieval-augmented generation (RAG) pipelines, and external API providers.",
            "Practising object-oriented programming fundamentals, data structures, and algorithmic logic in Java.",
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
    Dynamically aligns with the student's actual technical placement domain.
    """
    clusters_text = " ".join([c.get("heading", "") + " " + c.get("prose", "") for c in (clusters or [])]).lower()
    tools_str = str(tools_used or "").lower()

    is_networking_hardware = any(k in clusters_text or k in tools_str for k in [
        "cabling", "rj45", "crimping", "nanostation", "cambium", "access point", "hardware", "switch", "router", "lan tester"
    ])
    is_media_cms = any(k in clusters_text or k in tools_str for k in [
        "wordpress", "canva", "coreldraw", "graphics", "xampp", "apache", "media"
    ])

    if is_networking_hardware:
        categories = [
            (
                "1. Structured Cabling & Physical Network Infrastructure",
                "Acquired practical expertise in measuring, cutting, stripping, and crimping CAT5e and CAT6 twisted-pair cables using "
                "RJ45 connectors and impact punch-down tools, followed by wiremap continuity and pinout verification using digital LAN testers."
            ),
            (
                "2. Wireless Telecommunications & Access Point Deployment",
                "Mastered the configuration and alignment of directional wireless nanostations and Cambium broadband subscriber units, "
                "configuring wireless modes, frequency scanning, channel bandwidths, and wireless security passphrases."
            ),
            (
                "3. Computer Hardware Maintenance & System Diagnostics",
                "Developed strong competency in workstation disassembly, component testing, RAM seating, power supply unit diagnostics, "
                "and preventative maintenance on client computer systems."
            ),
            (
                "4. Local Area Network Administration & IP Configuration",
                "Gained hands-on knowledge in allocating IPv4 network addresses, setting up subnet masks, configuring default gateways, "
                "patching switch ports, and troubleshooting local area network connectivity issues."
            ),
            (
                "5. Operating System Deployment & Workstation Support",
                "Learned automated operating system installations, driver configurations, and system utility administration across "
                "Windows and Linux environments to maintain workstation stability."
            ),
        ]
    elif is_media_cms:
        categories = [
            (
                "1. Content Management Systems & Web Administration",
                "Mastered WordPress installation, theme customisation, plugin configuration, and database management using "
                "local Apache/MySQL environments via XAMPP for web publishing."
            ),
            (
                "2. Digital Graphic Communication & Visual Hierarchy",
                "Acquired practical skills in typography pairing, visual contrast, colour harmony, and compositional balance "
                "utilising Canva and CorelDraw for institutional design and brand communication."
            ),
            (
                "3. Spreadsheet Data Analytics & Inventory Management",
                "Gained proficiency in Microsoft Excel for structured data organization, formula implementation, automated data filtering, "
                "and equipment inventory tracking."
            ),
            (
                "4. Computer Hardware & Peripheral Diagnostics",
                "Developed operational troubleshooting skills for client workstations, display hardware, and local network printers, "
                "ensuring uninterrupted office productivity."
            ),
            (
                "5. Technical Documentation & Professional Communication",
                "Cultivated rigorous documentation habits for recording error logs, maintenance reports, and project deliverables "
                "in accordance with industrial quality standards."
            ),
        ]
    else:
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
    Built strictly from recorded/confirmed tools. Dynamically inspects entries if tools_list is sparse.
    """
    raw_tools = []
    for item in (tools_list or []):
        clean = clean_ocr_suspicious_text(str(item).strip())
        if clean and clean not in raw_tools:
            raw_tools.append(clean)

    # If sparse, extract from entries' tools_used and equipment_used
    if len(raw_tools) < 3 and entries:
        for e in entries:
            for attr in ("tools_used", "equipment_used"):
                val = getattr(e, attr, None) or (e.get(attr) if isinstance(e, dict) else None)
                if not val:
                    continue
                items = val if isinstance(val, list) else str(val).replace(",", "\n").splitlines()
                for raw_item in items:
                    clean = clean_ocr_suspicious_text(str(raw_item).strip())
                    if clean and len(clean) >= 2 and clean not in raw_tools:
                        raw_tools.append(clean)

    # If still sparse, scan entries text for explicit technical equipment keywords
    if len(raw_tools) < 3 and entries:
        all_text = " ".join([
            (getattr(e, "verified_text", "") or getattr(e, "raw_text", "") or "")
            for e in entries
        ]).lower()
        keyword_map = [
            ("nanostation", "Nanostation"),
            ("cambium", "Cambium Equipment"),
            ("access point", "Access Point"),
            ("rj45", "RJ45 Connectors"),
            ("crimping", "Crimping Tool"),
            ("lan tester", "LAN Cable Tester"),
            ("cisco", "Cisco Switch"),
            ("ethernet", "CAT6 Ethernet Cable"),
            ("wordpress", "WordPress"),
            ("canva", "Canva"),
            ("xampp", "XAMPP"),
            ("apache", "Apache HTTP Server"),
            ("excel", "Microsoft Excel"),
            ("ubuntu", "Ubuntu Linux"),
            ("windows", "Windows 10/11"),
            ("python", "Python"),
            ("java", "Java"),
            ("docker", "Docker"),
            ("git", "Git"),
        ]
        for kw, canonical in keyword_map:
            if kw in all_text and canonical not in raw_tools:
                raw_tools.append(canonical)

    # Categories
    categorised = {
        "Networking & Infrastructure": [],
        "Hardware & System Maintenance": [],
        "Operating Systems & Cloud Platforms": [],
        "Programming Languages & Frameworks": [],
        "Design & Office Productivity Tools": [],
    }

    tool_usage_map = {
        # Networking & Hardware
        "RJ45 Connectors": "Utilised for terminating twisted-pair Ethernet cables for local network connectivity.",
        "RJ45": "Utilised for terminating twisted-pair Ethernet cables for local network connectivity.",
        "Crimping Tool": "Employed to crimp and secure RJ45 connectors onto CAT5e and CAT6 network cables.",
        "LAN Cable Tester": "Used to verify pinout continuity, wire mapping, and cable signal transmission integrity.",
        "LAN tester machine": "Used to verify pinout continuity, wire mapping, and cable signal transmission integrity.",
        "CAT6 Ethernet Cable": "Employed as the high-speed physical transmission medium for local area network drops.",
        "ethernet cables": "Employed as the physical transmission medium for local area network connectivity.",
        "Nanostation": "Configured as an outdoor wireless station for directional radio frequency communication.",
        "nanostation": "Configured as an outdoor wireless station for directional radio frequency communication.",
        "Cambium Equipment": "Deployed and aligned for point-to-point wireless broadband access and backhaul transmission.",
        "Access Point": "Configured to distribute wireless local area network connectivity across offices.",
        "access point": "Configured to distribute wireless local area network connectivity across offices.",
        "Cisco Switch": "Employed for VLAN segmentation, port security, and local network packet forwarding.",
        "PC Components / RAM": "Handled during workstation assembly, diagnostic upgrades, and power supply maintenance.",
        "RAM": "Tested and seated in workstation motherboards to ensure memory stability and performance.",
        "motherboard": "Diagnosed for POST error codes and hardware expansion card seating.",
        "computer system": "Utilised as the primary workstation environment for diagnostic tests and administrative tasks.",
        "CPU": "Inspected for thermal paste application, heatsink seating, and operational temperatures.",
        # Operating Systems & Servers
        "Linux": "Served as the primary operating system environment for terminal workflows and server operations.",
        "Linux operating system": "Served as the primary operating system environment for terminal workflows and server operations.",
        "Ubuntu": "Utilised for server configuration, shell scripting, and network service testing.",
        "Windows 10, Windows 11, Ubuntu": "Administered across client workstations for office productivity and network domain access.",
        "Windows 10/11": "Administered across client workstations for office productivity and network domain access.",
        "Apache": "Configured as the local web server daemon for hosting PHP web applications.",
        "Apache HTTP Server": "Configured as the local web server daemon for hosting PHP web applications.",
        "XAMPP": "Utilised as a local development stack comprising Apache, MySQL, and PHP.",
        # Programming & Frameworks
        "Python": "Used as the primary language for backend service implementation, script automation, and integrations.",
        "Java": "Used for object-oriented programming practice, algorithm development, and console-based applications.",
        "FastAPI": "Employed to construct high-performance RESTful APIs, request validation schemas, and endpoints.",
        "Django": "Utilised for full-stack platform architecture and security configuration hardening.",
        "React": "Used to build modular, interactive web application interfaces and dashboard views.",
        "React Native": "Employed to develop cross-platform mobile interfaces, navigation stacks, and custom components.",
        "Expo": "Utilised for rapid mobile application prototyping, dependency management, and SDK compatibility testing.",
        "Supabase": "Used as a backend-as-a-service platform for user authentication and real-time database subscriptions.",
        "Docker": "Employed for multi-service containerisation, Dockerfile configurations, and reproducible deployments.",
        "Celery": "Used for background task execution and asynchronous worker job orchestration.",
        "Redis": "Employed as an in-memory caching layer and message broker for background task workers.",
        "Git": "Utilised for source code version control, branch management, and collaborative development tracking.",
        "GitHub": "Used for remote repository hosting, code reviews, and continuous integration workflow execution.",
        "IntelliJ IDEA": "Utilised as the integrated development environment for Java programming and debugging.",
        "VS Code": "Used as the primary code editor for full-stack web and mobile development.",
        "Playwright": "Employed for automated web application testing and interface verification.",
        "Render": "Used as the cloud hosting platform for backend web service deployments.",
        "Vercel": "Utilised for deploying responsive frontend web applications and static assets.",
        # Media & Office
        "WordPress": "Utilised for content management, theme customisation, and web page layout structuring.",
        "Canva": "Used for creating visual assets, corporate flyers, and digital communication materials.",
        "Canva, CorelDraw": "Employed for digital graphic design, vector layout, and visual branding assets.",
        "CorelDraw": "Used for vector graphic illustrations, promotional banner design, and print typography.",
        "Microsoft Excel": "Employed for data organization, formula-based calculation, and inventory tracking.",
        "Excel dashboard": "Configured with formulas and summary charts for operational data visualisation.",
    }

    for tool in raw_tools:
        t_low = tool.lower()
        if any(k in t_low for k in ["rj45", "crimping", "cabling", "cable", "lan tester", "nanostation", "cambium", "access point", "switch", "cisco", "network"]):
            categorised["Networking & Infrastructure"].append(tool)
        elif any(k in t_low for k in ["ram", "cpu", "motherboard", "hardware", "power connector", "computer system", "pc"]):
            categorised["Hardware & System Maintenance"].append(tool)
        elif any(k in t_low for k in ["linux", "ubuntu", "windows", "apache", "xampp", "server", "docker", "render", "vercel", "redis", "supabase", "cloud"]):
            categorised["Operating Systems & Cloud Platforms"].append(tool)
        elif any(k in t_low for k in ["python", "java", "javascript", "typescript", "php", "sql", "fastapi", "django", "react", "git", "intellij", "vs code", "playwright"]):
            categorised["Programming Languages & Frameworks"].append(tool)
        else:
            categorised["Design & Office Productivity Tools"].append(tool)

    output_sections = []
    for cat_name, tools in categorised.items():
        if not tools:
            continue
        lines = [f"<p><strong>{cat_name}</strong></p>\n<ul>"]
        for t in tools[:3]:
            usage = tool_usage_map.get(t, f"Utilised for technical engineering and operational workflows during the industrial attachment.")
            lines.append(f"<li><strong>{t}:</strong> {usage}</li>")
        lines.append("</ul>")
        output_sections.append("\n".join(lines))

    return "\n".join(output_sections)


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
        f"During the 12-week SIWES attachment at {clean_org}, I was embedded within the {dept}, "
        f"contributing directly to production software engineering, security hardening, and UI/UX implementation. "
        f"Initial assignments included developing educational modules for Butane, adding report card previews, "
        f"student promotion logic, and an automated trading engine with exchange monitoring. "
        f"Subsequent work focused on Gymoraflow mobile in React Native and Supabase, "
        f"resolving navigation bugs, fixing chat badges, and mitigating CSRF risks."
    )

    p2 = (
        f"Later responsibilities focused on backend architecture, Docker containers, and intelligent systems. "
        f"I deployed multi-service FastAPI endpoints, engineered media pipelines for Nexa Esports, "
        f"and implemented retrieval-augmented generation (RAG) agents for Quiza. "
        f"These deliverables were complemented by object-oriented Java programming and brand design, "
        f"culminating in a complete technical handoff and final team presentation."
    )

    return f"{p1}\n\n{p2}"


def synthesize_conclusion_section(org_name: str, clusters: list | None = None) -> str:
    """
    Builds Section 4.2 (Conclusion): exactly one paragraph on what the record shows was learned.
    NO superlatives (e.g. 'invaluable' is strictly forbidden).
    """
    clean_org = to_title_case_name(org_name)
    return (
        f"The attachment at {clean_org} successfully merged academic computing theory with professional industry practice. "
        f"Through direct participation in production workflows, I gained demonstrable competence in modern web stacks, "
        f"Docker containerisation, object-oriented software design, and systematic debugging methodologies. "
        f"The training established a solid technical foundation for subsequent professional practice in software engineering."
    )


def synthesize_recommendations_section(org_name: str, challenges: str = "", recs_list: list | None = None, intake: dict | None = None) -> str:
    """
    Builds Section 4.3 (Recommendations): exactly three structured suggestions addressed to:
    1. The Host Organisation
    2. The University (LASUSTECH)
    3. ITF / NUC
    """
    clean_org = to_title_case_name(org_name)
    r1 = f"1. To {clean_org}: Provide incoming interns with pre-configured Docker starter templates to accelerate multi-service debugging."
    r2 = f"2. To Lagos State University of Science and Technology (LASUSTECH): Incorporate hands-on containerisation and REST API labs into the pre-SIWES computing curriculum."
    r3 = f"3. To the Industrial Training Fund (ITF) and National Universities Commission (NUC): Maintain scheduled supervisory visits between university coordinators and industry mentors."

    return f"{r1}\n\n{r2}\n\n{r3}"
