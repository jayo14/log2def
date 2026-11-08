/**
 * Log2Def Guided Intake Presets, Starter Chips, and Organogram Templates
 * Designed for frictionless mobile completion of SIWES Chapter 2 & Chapter 3 facts.
 */

export interface ChallengePair {
  challenge: string;
  solution: string;
}

export interface ChallengeAnswer {
  none: boolean;
  pairs: ChallengePair[];
}

export const INDUSTRY_STARTER_CHIPS = [
  {
    label: '💻 IT & Software Consulting',
    text: 'A premier software development and IT consulting firm providing custom enterprise software, mobile application development, database architecture, and cloud infrastructure management to corporate and public sector clients.',
  },
  {
    label: '⚡ Engineering & Technical',
    text: 'A specialized electrical and systems engineering company engaged in industrial automation, power distribution systems, control panel installation, equipment maintenance, and technical commissioning services.',
  },
  {
    label: '🌐 Telecom & Networking',
    text: 'A telecommunications and network solutions provider delivering enterprise fiber connectivity, wireless transmission, network security, data center installations, and managed IT services across Nigeria.',
  },
  {
    label: '🏦 Financial & Fintech',
    text: 'A financial technology solutions provider developing secure digital payment processing platforms, core banking integrations, POS transaction switching, and financial data analytics systems.',
  },
  {
    label: '🏥 Healthcare & Diagnostics',
    text: 'A healthcare and biomedical diagnostics center providing automated laboratory testing, medical imaging, clinical diagnostics, and hospital laboratory information system management.',
  },
];

export const OBJECTIVES_STARTER_CHIPS = [
  {
    label: '🚀 Innovation & Quality',
    text: 'Mission: To empower African businesses through cutting-edge digital technology and dependable software solutions. Vision: To become the leading technology partner for emerging enterprises across West Africa.',
  },
  {
    label: '🛡️ Enterprise Excellence',
    text: 'Mission: To deliver safe, efficient, and cost-effective engineering solutions meeting international standards. Vision: To set the benchmark for technical integrity, engineering innovation, and workforce development.',
  },
  {
    label: '📈 Client Impact & Reliability',
    text: 'Mission: To provide uninterrupted, high-availability IT infrastructure and support that accelerates client productivity. Vision: To be recognized as the most dependable managed services provider in the region.',
  },
];

export const STRUCTURE_HELPER_CHIPS = [
  {
    label: '🏢 Standard Tech Firm',
    text: 'Headed by the Managing Director / CEO. Main departments include Software Engineering, Network & Infrastructure, Quality Assurance, and Operations. I was attached to the Software Engineering unit and reported directly to the Lead Software Engineer.',
  },
  {
    label: '⚙️ Industrial / Engineering',
    text: 'Headed by the General Manager. Main departments include Operations, Electrical Engineering, Quality Control, and Safety/Maintenance. I was attached to the Electrical Maintenance Unit and reported to the Principal Engineer.',
  },
  {
    label: '📊 Corporate IT Department',
    text: 'Headed by the Chief Information Officer (CIO) / IT Director. Main departments include Systems Administration, Applications Development, and User Support. I was attached to the Applications Development team and reported to the Senior Systems Analyst.',
  },
];

export const ORGANOGRAM_TEMPLATES = [
  {
    id: 'tech',
    label: '💻 Tech / IT Firm',
    tree: `Managing Director / CEO
  Technical Director
    Lead Software Engineer
      Frontend Developer
      Backend Developer
      SIWES Intern (Student)
    Quality Assurance Lead
  Operations Manager
    Support Specialist`,
  },
  {
    id: 'engineering',
    label: '⚙️ Engineering Firm',
    tree: `General Manager
  Head of Engineering
    Senior Project Engineer
      Field Technician
      Industrial Trainee (Student)
    Quality Control Inspector
  Operations & Safety Manager
    Safety Officer`,
  },
  {
    id: 'corporate',
    label: '🏢 Corporate / Agency',
    tree: `Chief Executive Officer
  Director of IT & Systems
    Systems Administrator
    Database Specialist
    IT Intern (Student)
  Head of Administration
    HR Officer`,
  },
];

export const COMMON_CHALLENGE_PRESETS: { title: string; pair: ChallengePair }[] = [
  {
    title: '🔧 Codebase & Git Version Control',
    pair: {
      challenge: 'Initial difficulty navigating large production repositories, branching conventions, and resolving Git merge conflicts.',
      solution: 'Studied internal team documentation, practiced Git commands in isolated sandbox branches, and paired with senior developers during pull request reviews.',
    },
  },
  {
    title: '⚡ Network Latency & Server Sync',
    pair: {
      challenge: 'Intermittent internet connectivity and unstable power supply slowing down package installations and remote server deployments.',
      solution: 'Configured local offline caching with Docker containers and scheduled heavier data syncs during low-traffic periods.',
    },
  },
  {
    title: '📚 Unfamiliar Technology Framework',
    pair: {
      challenge: 'Steep learning curve adapting to unfamiliar backend frameworks, asynchronous API patterns, and relational schema migrations.',
      solution: 'Completed official framework documentation tutorials, reviewed existing project codebase patterns, and consulted my unit supervisor for code structure guidance.',
    },
  },
];

export const RECOMMENDATION_PRESETS = [
  {
    label: '🎓 Structured Onboarding',
    text: 'The organisation should establish a structured 2-week orientation workshop with documented onboarding tutorials to help future SIWES interns adapt rapidly to production tools and coding standards.',
  },
  {
    label: '💻 Dedicated Lab Workstations',
    text: 'The department should allocate dedicated development workstations and testing peripherals to interns, reducing downtime and accelerating practical skill acquisition.',
  },
  {
    label: '👥 Scheduled Mentorship Sessions',
    text: 'Future internship programs would benefit from weekly scheduled one-on-one mentorship sessions and peer code reviews between student trainees and senior technical staff.',
  },
];

/**
 * Format an organogram string into displayable visual nodes with depth.
 */
export function parseOrganogramTree(raw: string): { text: string; depth: number }[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split('\n')
    .map((line) => {
      const match = line.match(/^(\s*)(.*)$/);
      if (!match) return null;
      const leadingSpaces = match[1].length;
      const depth = Math.floor(leadingSpaces / 2);
      const text = match[2].trim();
      if (!text) return null;
      return { text, depth };
    })
    .filter((node): node is { text: string; depth: number } => node !== null);
}
