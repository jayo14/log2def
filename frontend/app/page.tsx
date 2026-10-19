'use client';

import React, { useEffect, useState, useRef, useTransition } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import './landing.css';

interface SampleReport {
  course: string;
  title: string;
  name: string;
  place: string;
  weeks: number;
  pages: number;
  rows: [string, string][];
  para: string;
  fig: string;
}

const SAMPLE_REPORTS: SampleReport[] = [
  {
    course: 'Electrical Engineering',
    title: 'Technical Report on Industrial Training in Power Distribution',
    name: 'Tunde A.',
    place: 'Power distribution company, Lagos',
    weeks: 24,
    pages: 58,
    rows: [
      ['Week 1', 'Safety induction and site orientation'],
      ['Week 3', 'Assisted in rewiring a distribution board'],
      ['Week 8', 'Earthing tests and meter readings'],
      ['Week 15', 'Transformer maintenance checks'],
    ],
    para: 'In week 3, I assisted the technician in rewiring a distribution board. We isolated the supply, replaced the damaged cables and tested each circuit before restoring power.',
    fig: 'Fig 3.1 Distribution board after rewiring',
  },
  {
    course: 'Animal Production',
    title: 'Technical Report on Industrial Training at a Poultry and Livestock Farm',
    name: 'Amaka O.',
    place: 'Poultry and livestock farm, Ogun State',
    weeks: 24,
    pages: 52,
    rows: [
      ['Week 1', 'Farm orientation and biosecurity briefing'],
      ['Week 4', 'Feed formulation and ration mixing'],
      ['Week 9', 'Vaccination schedule and record keeping'],
      ['Week 16', 'Egg collection and grading'],
    ],
    para: 'In week 4, I helped prepare layer feed using the farm’s ration sheet. We weighed each ingredient, mixed in batches and recorded the quantity issued to each pen.',
    fig: 'Fig 3.2 Vaccination record sheet',
  },
  {
    course: 'Computer Science',
    title: 'Technical Report on Industrial Training in Software Development',
    name: 'Ibrahim K.',
    place: 'Software company, Lagos',
    weeks: 24,
    pages: 61,
    rows: [
      ['Week 2', 'Set up dev environment and Git workflow'],
      ['Week 6', 'Built REST endpoints with FastAPI'],
      ['Week 11', 'Wrote unit tests and fixed login bugs'],
      ['Week 18', 'Deployed to the staging server'],
    ],
    para: 'In week 6, I built REST endpoints for the customer module using FastAPI. Each route was tested with sample requests before it was merged into the main branch.',
    fig: 'Fig 3.1 API request flow',
  },
  {
    course: 'Accounting',
    title: 'Technical Report on Industrial Training at an Accounting Firm',
    name: 'Chioma E.',
    place: 'Accounting firm, Lagos',
    weeks: 24,
    pages: 47,
    rows: [
      ['Week 1', 'Introduction to client files'],
      ['Week 5', 'Bank reconciliation for two clients'],
      ['Week 10', 'Prepared payroll schedules'],
      ['Week 17', 'Assisted in audit sampling'],
    ],
    para: 'In week 5, I reconciled the bank statements of two clients against their cash books. Each unmatched item was traced, queried and recorded on the reconciliation schedule.',
    fig: 'Fig 3.1 Reconciliation workflow',
  },
];

const DEFENCE_QUESTIONS = [
  [
    'Troubleshooting',
    'The earthing readings on site were too high. What did you do?',
    'Describe the fault, the tool you used to measure it, the fix, and how you confirmed it afterwards. Use your own Week 3 entry.',
  ],
  [
    'Tools',
    'Why did you choose that meter for the test?',
    'Name the instrument, what it measures, and what you checked before trusting its reading.',
  ],
  [
    'Cross-examination',
    'What would you do differently if you repeated this task?',
    'Be honest about one challenge from your report and what you learned from it.',
  ],
];

export default function LandingPage() {
  const { user } = useAuth();

  // Scroll Progress Bar
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function updateScrollProgress() {
      if (!barRef.current) return;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      barRef.current.style.transform = `scaleX(${h > 0 ? window.scrollY / h : 0})`;
    }
    window.addEventListener('scroll', updateScrollProgress, { passive: true });
    updateScrollProgress();
    return () => window.removeEventListener('scroll', updateScrollProgress);
  }, []);

  // Hero Stage Sequential Animation
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const st = stageRef.current;
    if (!st) return;

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      st.className = 'stage s1 s3 s4 s5 s6 s7 s8';
      return;
    }

    const seq: [number, string][] = [
      [200, 's1'],
      [4200, 's2'],
      [6000, 's3'],
      [6900, 's4'],
      [9900, 's5'],
      [10700, 's6'],
      [11300, 's7'],
      [11900, 's8'],
    ];
    const DUR = 15800;
    let timeouts: NodeJS.Timeout[] = [];

    function runAnimation() {
      timeouts.forEach(clearTimeout);
      timeouts = [];
      if (!st) return;
      st.className = 'stage nt';
      void st.offsetWidth; // force reflow
      st.classList.remove('nt');

      seq.forEach(([delay, cls]) => {
        timeouts.push(
          setTimeout(() => {
            if (st) st.classList.add(cls);
          }, delay)
        );
      });

      timeouts.push(
        setTimeout(() => {
          if (st) st.classList.add('out');
        }, DUR - 800)
      );

      timeouts.push(
        setTimeout(() => {
          runAnimation();
        }, DUR)
      );
    }

    runAnimation();
    return () => timeouts.forEach(clearTimeout);
  }, []);

  // Process Steps IntersectionObserver
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute('data-s'));
            if (!isNaN(index)) setActiveStep(index);
          }
        });
      },
      { rootMargin: '-45% 0px -45% 0px' }
    );

    stepRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  // Mock Defence Card State
  const [qIndex, setQIndex] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);

  // Sample Reports Carousel & Tabs State
  const [curReport, setCurReport] = useState(0);
  const [curPage, setCurPage] = useState(0);
  const [isSwapping, setIsSwapping] = useState(false);
  const reportsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const switchReport = (targetReport: number, targetPage: number) => {
    if (targetReport !== curReport) {
      setIsSwapping(true);
      setTimeout(() => {
        setCurReport(targetReport);
        setCurPage(targetPage);
        setIsSwapping(false);
      }, 260);
    } else {
      setCurPage(targetPage);
    }
  };

  const startAutoRotation = () => {
    stopAutoRotation();
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    reportsIntervalRef.current = setInterval(() => {
      setCurPage((prevPg) => {
        if (prevPg >= 2) {
          setCurReport((prevR) => (prevR + 1) % SAMPLE_REPORTS.length);
          return 0;
        }
        return prevPg + 1;
      });
    }, 4500);
  };

  const stopAutoRotation = () => {
    if (reportsIntervalRef.current) {
      clearInterval(reportsIntervalRef.current);
      reportsIntervalRef.current = null;
    }
  };

  useEffect(() => {
    startAutoRotation();
    return () => stopAutoRotation();
  }, []);

  const report = SAMPLE_REPORTS[curReport];

  const authTarget = user ? '/dashboard' : '/register';
  const loginTarget = user ? '/dashboard' : '/login';

  return (
    <div className="landing-root">
      {/* Navigation */}
      <nav>
        <Link href={user ? '/dashboard' : '/'} className="logo">
          <img src="/icons/icon-72.png" alt="Log2Def Logo" className="mark" width={34} height={34} style={{ borderRadius: '10px', objectFit: 'contain' }} />
          Log2Def
        </Link>
        <div className="links">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#reports">Reports</a>
          <a href="#defence">Mock defence</a>
          <a href="#faq">FAQ</a>
        </div>
        <Link className="btn p" href={authTarget}>
          {user ? 'Go to Dashboard' : 'Get started'}
        </Link>
        <div id="bar" ref={barRef}></div>
      </nav>

      {/* Hero Header */}
      <header className="hero">
        <div className="blob b1"></div>
        <div className="blob b2"></div>
        <div className="wrap hgrid">
          <div>
            <span className="pill">
              <i></i>Designed for LASUSTECH and Nigerian universities
            </span>
            <h1>From logbook to defence-ready.</h1>
            <svg className="swash" viewBox="0 0 430 22" preserveAspectRatio="none" aria-hidden="true">
              <path d="M4 14 C 90 4, 160 20, 250 10 S 380 6, 426 12" />
            </svg>
            <p className="lede">
              Turn your real SIWES logbook entries, photos and rough technical notes into a structured, editable, printable report, then practise defending it with confidence.
            </p>
            <div className="cta">
              <Link className="btn p" href={authTarget}>
                Create your report <span aria-hidden="true">→</span>
              </Link>
              <a className="btn g" href="#how">
                See how it works
              </a>
            </div>
            <div className="trust">
              <span>Grounded in your real work</span>
              <span>A4 DOCX and PDF exports</span>
              <span>Mock defence exam</span>
            </div>
          </div>

          {/* Hero Stage Animation */}
          <div className="stage" id="stage" ref={stageRef} aria-hidden="true">
            <div className="sheet log">
              <p className="hw">
                <span style={{ '--i': 0 } as React.CSSProperties}>Mon:</span>{' '}
                <span style={{ '--i': 1 } as React.CSSProperties}>rewired</span>{' '}
                <span style={{ '--i': 2 } as React.CSSProperties}>the</span>{' '}
                <span style={{ '--i': 3 } as React.CSSProperties}>distribution</span>{' '}
                <span style={{ '--i': 4 } as React.CSSProperties}>board</span>{' '}
                <span style={{ '--i': 5 } as React.CSSProperties}>with</span>{' '}
                <span style={{ '--i': 6 } as React.CSSProperties}>the</span>{' '}
                <span style={{ '--i': 7 } as React.CSSProperties}>technician.</span>{' '}
                <span style={{ '--i': 8 } as React.CSSProperties}>Tue:</span>{' '}
                <span style={{ '--i': 9 } as React.CSSProperties}>tested</span>{' '}
                <span style={{ '--i': 10 } as React.CSSProperties}>the</span>{' '}
                <span className="un" style={{ '--i': 11 } as React.CSSProperties}>
                  earthing
                </span>{' '}
                <span style={{ '--i': 12 } as React.CSSProperties}>and</span>{' '}
                <span style={{ '--i': 13 } as React.CSSProperties}>wrote</span>{' '}
                <span style={{ '--i': 14 } as React.CSSProperties}>down</span>{' '}
                <span style={{ '--i': 15 } as React.CSSProperties}>readings.</span>{' '}
                <span style={{ '--i': 16 } as React.CSSProperties}>Wed:</span>{' '}
                <span style={{ '--i': 17 } as React.CSSProperties}>site</span>{' '}
                <span style={{ '--i': 18 } as React.CSSProperties}>visit,</span>{' '}
                <span style={{ '--i': 19 } as React.CSSProperties}>took</span>{' '}
                <span style={{ '--i': 20 } as React.CSSProperties}>photos.</span>
              </p>
              <div className="scan"></div>
            </div>

            <div className="upl">
              <div className="ci">
                <span className="ms">cloud_upload</span>
              </div>
              <div>
                <span className="ut">Uploading page 4</span>
                <span className="pbar">
                  <i></i>
                </span>
              </div>
            </div>

            <div className="sheet rep">
              <h4>3.2 Weekly activities</h4>
              <small>Week 3 · Electrical installation</small>
              <div className="lns">
                <i className="ln" style={{ '--i': 0, width: '100%' } as React.CSSProperties}></i>
                <i className="ln" style={{ '--i': 1, width: '92%' } as React.CSSProperties}></i>
                <i className="ln" style={{ '--i': 2, width: '97%' } as React.CSSProperties}></i>
                <i className="ln" style={{ '--i': 3, width: '70%' } as React.CSSProperties}></i>
                <i className="ln" style={{ '--i': 4, width: '94%' } as React.CSSProperties}></i>
                <i className="ln" style={{ '--i': 5, width: '88%' } as React.CSSProperties}></i>
                <i className="ln" style={{ '--i': 6, width: '96%' } as React.CSSProperties}></i>
                <i className="ln" style={{ '--i': 7, width: '55%' } as React.CSSProperties}></i>
              </div>
              <div className="stamp">
                <span className="ms">verified</span>Defence-ready
              </div>
            </div>

            <div className="chip k1">
              <span className="ci">
                <span className="ms">warning</span>
              </span>
              1 unclear word flagged
            </div>
            <div className="chip k2">
              <span className="ci">
                <span className="ms">lock</span>
              </span>
              Your edits stay locked
            </div>
            <div className="chip k3">
              <span className="ci">
                <span className="ms">quiz</span>
              </span>
              15 defence questions ready
            </div>
          </div>
        </div>
      </header>

      {/* Proof Strip */}
      <div className="strip">
        <div className="wrap">
          <span className="si">
            <span className="ms">verified_user</span>Built from your real entries, never invented
          </span>
          <span className="si">
            <span className="ms">menu_book</span>The standard five-chapter SIWES report
          </span>
          <span className="si">
            <span className="ms">print</span>Print-ready for binding
          </span>
          <span className="si">
            <span className="ms">record_voice_over</span>Defence practice from your own work
          </span>
        </div>
      </div>

      {/* How It Works Section */}
      <section id="how">
        <div className="wrap">
          <h2 className="h2">Three clear steps to your defence.</h2>
          <p className="sub">No fabricated work. No prompt engineering. Just your logbook, organised.</p>
          <div className="proc">
            <div className="vis">
              <div className={`pane ${activeStep === 0 ? 'on' : ''}`} data-p="0">
                <div className="gl tight fr">
                  <div className="ib">
                    <span className="ms">upload_file</span>
                  </div>
                  <div>
                    <b>Add your entries</b>
                    <span className="sm">Scans, photos, PDFs or typed notes</span>
                  </div>
                  <span className="tag" style={{ margin: '0 0 0 auto' }}>
                    <span className="ms">check_circle</span>3 files
                  </span>
                </div>
                <div className="gl">
                  <div className="fr" style={{ marginBottom: '10px' }}>
                    <span className="ms" style={{ color: 'var(--green)' }}>
                      document_scanner
                    </span>
                    <b>Week 3 · page 4</b>
                    <span className="tag" style={{ margin: '0 0 0 auto', background: 'rgba(240,180,41,.32)', color: '#8a5a00' }}>
                      1 to check
                    </span>
                  </div>
                  “Tested the <span className="warn">ea&#8203;rthing</span> and recorded the readings from the meter.”
                </div>
                <div className="gl tight fr">
                  <div className="ib am">
                    <span className="ms">edit_note</span>
                  </div>
                  <div>
                    <b>Low confidence</b>
                    <span className="sm">Correct the word, then verify</span>
                  </div>
                  <span className="vb">
                    <span className="ms">verified</span>Verify
                  </span>
                </div>
              </div>

              <div className={`pane ${activeStep === 1 ? 'on' : ''}`} data-p="1">
                <div className="chp">
                  <span className="ms">auto_stories</span>Preliminary pages
                </div>
                <div className="chp">
                  <span className="ms">flag</span>Introduction
                </div>
                <div className="chp">
                  <span className="ms">apartment</span>Company profile
                </div>
                <div className="chp act">
                  <span className="ms">engineering</span>Activities
                  <span style={{ marginLeft: 'auto', fontSize: '12px', opacity: 0.85 }}>Editing</span>
                </div>
                <div className="chp">
                  <span className="ms">task_alt</span>Challenges and conclusion
                </div>
                <div className="gl tight">
                  <div className="fr" style={{ marginBottom: '8px' }}>
                    <span className="ms" style={{ fontSize: '20px' }}>
                      format_bold
                    </span>
                    <span className="ms" style={{ fontSize: '20px' }}>
                      format_italic
                    </span>
                    <span className="ms" style={{ fontSize: '20px' }}>
                      format_list_bulleted
                    </span>
                    <span className="tag" style={{ margin: '0 0 0 auto' }}>
                      <span className="ms">lock</span>Locked
                    </span>
                  </div>
                  Week 3 · I assisted in rewiring a distribution board…
                </div>
              </div>

              <div className={`pane ${activeStep === 2 ? 'on' : ''}`} data-p="2">
                <div className="gl tight fr">
                  <div className="ib">
                    <span className="ms">description</span>
                  </div>
                  <div>
                    <b>Technical report.docx</b>
                    <span className="sm">A4 · 1.5 inch binding margin</span>
                  </div>
                  <span className="ms" style={{ marginLeft: 'auto', color: 'var(--green)' }}>
                    download
                  </span>
                </div>
                <div className="gl tight fr">
                  <div className="ib">
                    <span className="ms">picture_as_pdf</span>
                  </div>
                  <div>
                    <b>Technical report.pdf</b>
                    <span className="sm">Matching pagination</span>
                  </div>
                  <span className="ms" style={{ marginLeft: 'auto', color: 'var(--green)' }}>
                    download
                  </span>
                </div>
                <div className="gl">
                  <div className="fr">
                    <div className="ib">
                      <span className="ms">record_voice_over</span>
                    </div>
                    <div>
                      <b>Mock defence</b>
                      <span className="sm">Question 4 of 15 · Tools</span>
                    </div>
                  </div>
                  <div className="prog">
                    <b style={{ width: '27%' }}></b>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div
                className={`step ${activeStep === 0 ? 'on' : ''}`}
                data-s="0"
                ref={(el) => {
                  stepRefs.current[0] = el;
                }}
              >
                <span>Step 1</span>
                <h3>Upload and verify</h3>
                <p>
                  Add scans, photos, PDF pages or typed notes of your weekly entries. Correct any handwriting the app is unsure about, then verify each milestone.
                </p>
              </div>
              <div
                className={`step ${activeStep === 1 ? 'on' : ''}`}
                data-s="1"
                ref={(el) => {
                  stepRefs.current[1] = el;
                }}
              >
                <span>Step 2</span>
                <h3>Generate and edit</h3>
                <p>
                  Your verified entries become the five standard SIWES chapters: preliminary pages, introduction, profile, activities, and challenges with conclusion. Edit anything in the rich-text workspace.
                </p>
              </div>
              <div
                className={`step ${activeStep === 2 ? 'on' : ''}`}
                data-s="2"
                ref={(el) => {
                  stepRefs.current[2] = el;
                }}
              >
                <span>Step 3</span>
                <h3>Export and prepare</h3>
                <p>
                  Download A4 Word and PDF files with proper binding margins, then rehearse with mock defence questions grounded in what you actually did.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Bento Grid */}
      <section id="features" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2 className="h2">Built for technical integrity.</h2>
          <div className="bento">
            <div className="bx w4">
              <div className="ib">
                <span className="ms">cloud_upload</span>
              </div>
              <h3>Smart document extraction</h3>
              <p>
                Multi-page PDFs, high-resolution photos, DOCX notes and typed text. Low-confidence handwriting is highlighted so you correct it yourself instead of trusting a guess.
              </p>
              <div className="rows">
                <div>
                  <span className="fr">
                    <span className="ms" style={{ color: 'var(--green)' }}>
                      picture_as_pdf
                    </span>
                    Logbook_week3.pdf
                  </span>
                  <span className="fr ok">
                    <span className="ms">check_circle</span>Read
                  </span>
                </div>
                <div>
                  <span className="fr">
                    <span className="ms" style={{ color: 'var(--green)' }}>
                      image
                    </span>
                    Site_photo_12.jpg
                  </span>
                  <span className="fr ok">
                    <span className="ms">check_circle</span>Read
                  </span>
                </div>
                <div>
                  <span className="fr">
                    <span className="ms" style={{ color: 'var(--green)' }}>
                      draw
                    </span>
                    Handwritten_p4.png
                  </span>
                  <span className="fr chk2">
                    <span className="ms">warning</span>1 word to check
                  </span>
                </div>
              </div>
            </div>

            <div className="bx w2 dark">
              <div className="ib">
                <span className="ms">school</span>
              </div>
              <h3>Institution template</h3>
              <p>
                Follows LASUSTECH and Nigerian ITF report structure, from the cover page and supervisor certification to recommendations.
              </p>
              <div className="mini">
                <i></i>
                <i></i>
                <i></i>
                <i></i>
              </div>
            </div>

            <div className="bx w2">
              <div className="ib">
                <span className="ms">lock</span>
              </div>
              <h3>Edits that stay</h3>
              <p>
                Change a section and it is locked, so regenerating another chapter never overwrites your own words.
              </p>
            </div>

            <div className="bx w4">
              <div className="ib">
                <span className="ms">file_download</span>
              </div>
              <h3>Real academic export</h3>
              <p>
                Word files with a 1.5 inch left margin, 1.5 line spacing and Times New Roman, plus PDFs with matching pagination.
              </p>
              <div className="rows ex">
                <div>
                  <span className="ms">description</span>
                  <span>DOCX</span>
                </div>
                <div>
                  <span className="ms">picture_as_pdf</span>
                  <span>PDF</span>
                </div>
                <div>
                  <span className="ms">crop_portrait</span>
                  <span>A4</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Sample Reports Showcase */}
      <section id="reports">
        <div className="wrap">
          <h2 className="h2">See finished reports before you start.</h2>
          <p className="sub">
            Browse reports published with Log2Def, from the cover page to the weekly log to the technical chapters. Yours follows the same structure, built from your own entries.
          </p>
          <div
            className="rp"
            onMouseEnter={stopAutoRotation}
            onMouseLeave={startAutoRotation}
            onFocus={stopAutoRotation}
            onBlur={startAutoRotation}
          >
            <div>
              <div className={`rp-stack ${isSwapping ? 'sw' : ''}`} id="rpStack" aria-live="polite">
                {/* Page 0: Cover */}
                <div className="rp-page" data-o={(0 - curPage + 3) % 3}>
                  <div className="pp c">
                    <p className="k">Technical report on student industrial work experience</p>
                    <h5>{report.title}</h5>
                    <p>Submitted by</p>
                    <b>{report.name}</b>
                    <p>{report.course}</p>
                    <p className="k">{report.weeks}-week SIWES placement</p>
                  </div>
                </div>

                {/* Page 1: Weekly Log */}
                <div className="rp-page" data-o={(1 - curPage + 3) % 3}>
                  <div className="pp">
                    <h6>Weekly log</h6>
                    <table>
                      <tbody>
                        {report.rows.map(([w, desc], idx) => (
                          <tr key={idx}>
                            <td>{w}</td>
                            <td>{desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="k">Verified by the industry-based supervisor</p>
                  </div>
                </div>

                {/* Page 2: Chapter 3 */}
                <div className="rp-page" data-o={(2 - curPage + 3) % 3}>
                  <div className="pp">
                    <h6>Chapter 3: Technical procedures</h6>
                    <p>{report.para}</p>
                    <div className="fig">
                      <span className="ms">image</span>
                    </div>
                    <p className="k">{report.fig}</p>
                  </div>
                </div>
              </div>

              {/* Tabs for pages within current report */}
              <div className="rp-tabs" id="rpTabs">
                <button
                  type="button"
                  className={curPage === 0 ? 'on' : ''}
                  aria-pressed={curPage === 0}
                  onClick={() => switchReport(curReport, 0)}
                >
                  <span className="ms">article</span>Cover page
                </button>
                <button
                  type="button"
                  className={curPage === 1 ? 'on' : ''}
                  aria-pressed={curPage === 1}
                  onClick={() => switchReport(curReport, 1)}
                >
                  <span className="ms">table_chart</span>Weekly log
                </button>
                <button
                  type="button"
                  className={curPage === 2 ? 'on' : ''}
                  aria-pressed={curPage === 2}
                  onClick={() => switchReport(curReport, 2)}
                >
                  <span className="ms">engineering</span>Chapter 3
                </button>
              </div>
            </div>

            <div>
              {/* Report Info Card */}
              <div className="rp-info" id="rpInfo">
                <span className="tag">Sample report</span>
                <h3>{report.course}</h3>
                <p>{report.title}</p>
                <ul className="rp-meta">
                  <li>
                    <span className="ms">person</span>
                    {report.name}
                  </li>
                  <li>
                    <span className="ms">apartment</span>
                    {report.place}
                  </li>
                  <li>
                    <span className="ms">calendar_month</span>
                    {report.weeks} weeks of placement
                  </li>
                  <li>
                    <span className="ms">description</span>
                    {report.pages} pages, 5 chapters
                  </li>
                </ul>
              </div>

              {/* Report Category List */}
              <div className="rp-list" id="rpList">
                {SAMPLE_REPORTS.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`rp-item ${idx === curReport ? 'on' : ''}`}
                    onClick={() => switchReport(idx, 0)}
                  >
                    <span>
                      {item.course}
                      <small>
                        {item.name} · {item.pages} pages
                      </small>
                    </span>
                    <span className="ms">check_circle</span>
                  </button>
                ))}
              </div>

              {/* Navigation Controls */}
              <div className="rp-nav">
                <button
                  className="i"
                  type="button"
                  id="rpPrev"
                  aria-label="Previous report"
                  onClick={() =>
                    switchReport((curReport - 1 + SAMPLE_REPORTS.length) % SAMPLE_REPORTS.length, 0)
                  }
                >
                  <span className="ms">chevron_left</span>
                </button>
                <button
                  className="i"
                  type="button"
                  id="rpNext"
                  aria-label="Next report"
                  onClick={() => switchReport((curReport + 1) % SAMPLE_REPORTS.length, 0)}
                >
                  <span className="ms">chevron_right</span>
                </button>
                <Link className="btn p" href={authTarget}>
                  Start your report
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Defence Q&A Section */}
      <section id="defence" style={{ paddingTop: 0 }}>
        <div className="wrap def">
          <div>
            <h2 className="h2">Walk into the room already rehearsed.</h2>
            <p className="sub">
              Questions on tasks, tools, troubleshooting and examiner cross-examination, all drawn from your own report.
            </p>
          </div>
          <div className="qcard">
            <span className="tag" id="qt">
              {DEFENCE_QUESTIONS[qIndex][0]}
            </span>
            <h3 id="qq">{DEFENCE_QUESTIONS[qIndex][1]}</h3>
            <p className={`hint ${hintOpen ? 'on' : ''}`} id="qh">
              {DEFENCE_QUESTIONS[qIndex][2]}
            </p>
            <div className="row">
              <button
                className="btn p"
                id="rev"
                type="button"
                onClick={() => setHintOpen((prev) => !prev)}
              >
                {hintOpen ? 'Hide answer guidance' : 'Show how to answer'}
              </button>
              <button
                className="btn g"
                id="nxt"
                type="button"
                onClick={() => {
                  setQIndex((prev) => (prev + 1) % DEFENCE_QUESTIONS.length);
                  setHintOpen(false);
                }}
              >
                Next question
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Accordion Section */}
      <section id="faq" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2 className="h2" style={{ textAlign: 'center', margin: '0 auto' }}>
            Honest answers.
          </h2>
          <div className="faq">
            <details open>
              <summary>Does Log2Def fabricate work I didn’t perform?</summary>
              <p>
                No. It needs your reviewed logbook entries and placement details as its factual base, and turns concise notes into clear technical prose without inventing companies, tools or project outcomes.
              </p>
            </details>
            <details>
              <summary>Is Log2Def an official LASUSTECH portal?</summary>
              <p>
                No. It is an independent productivity app built around LASUSTECH and Nigerian ITF guidelines. It does not replace your departmental submission process, so always review your report with your supervisor.
              </p>
            </details>
            <details>
              <summary>Can I edit my chapters after they are generated?</summary>
              <p>
                Yes. Every section has a rich-text editor with autosave. Once you edit a section it is locked, so regenerating other sections never overwrites it.
              </p>
            </details>
            <details>
              <summary>Can Log2Def run without an AI API key?</summary>
              <p>
                Yes. A rule-based mode structures your placement details, weekly tables and challenges into full chapters with no external API key.
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* Final Call to Action */}
      <section id="start" style={{ paddingTop: '20px' }}>
        <div className="final">
          <div className="wrap fgrid">
            <div>
              <h2>Ready to compile your SIWES report?</h2>
              <p>
                Get your handwritten logbook organised, generate your five-chapter report and practise your defence today.
              </p>
              <div className="cta">
                <Link className="btn" href={authTarget}>
                  Start your report project <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="wrap">
          <div className="ftop">
            <div>
              <div className="logo">
                <img src="/icons/icon-72.png" alt="Log2Def Logo" className="mark" width={34} height={34} style={{ borderRadius: '10px', objectFit: 'contain' }} />
                Log2Def
              </div>
              <p>Turn your SIWES logbook into a report you can defend, built for Nigerian higher institutions.</p>
            </div>
            <div>
              <h5>Product</h5>
              <ul>
                <li>
                  <a href="#how">How it works</a>
                </li>
                <li>
                  <a href="#features">Features</a>
                </li>
                <li>
                  <a href="#reports">Sample reports</a>
                </li>
                <li>
                  <a href="#defence">Mock defence</a>
                </li>
              </ul>
            </div>
            <div>
              <h5>Support</h5>
              <ul>
                <li>
                  <a href="#faq">FAQ</a>
                </li>
                <li>
                  <a href="#faq">Is it official?</a>
                </li>
                <li>
                  <a href="#faq">Works without AI</a>
                </li>
              </ul>
            </div>
            <div>
              <h5>Get started</h5>
              <ul>
                <li>
                  <Link href={authTarget}>Create your report</Link>
                </li>
                <li>
                  <Link href={loginTarget}>Sign in</Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="fnote">
            <span>
              <b>Academic integrity.</b> Always review and verify all generated content before submission.
            </span>
          </div>
          <div className="fbot">
            <span>© 2026 Log2Def. Built for Nigerian higher institutions.</span>
            <span>Independent app, not an official LASUSTECH portal.</span>
          </div>
        </div>
        <div className="giant" aria-hidden="true">
          Log2Def
        </div>
      </footer>
    </div>
  );
}
