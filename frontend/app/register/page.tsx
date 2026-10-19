'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import '@/app/auth.css';

export default function RegisterPage() {
  const { register } = useAuth();

  const [fullName, setFullName] = useState('');
  const [university, setUniversity] = useState('LASUSTECH');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);

  // Field error flags
  const [nameError, setNameError] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setToastVisible(true);
    setTimeout(() => {
      setToastVisible(false);
    }, 2600);
  };

  // Score password 0..4
  const getPasswordScore = (p: string) => {
    let s = 0;
    if (p.length >= 8) s++;
    if (/[a-z]/i.test(p) && /\d/.test(p)) s++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p) && p.length >= 8) s++;
    return p ? Math.max(1, s) : 0;
  };

  const isValidEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');

    const validName = fullName.trim().length > 0;
    const validEmail = isValidEmail(email.trim());
    const validPw = password.length >= 8 && /[a-z]/i.test(password) && /\d/.test(password);

    setNameError(!validName);
    setEmailError(!validEmail);
    setPasswordError(!validPw);

    if (!validName || !validEmail || !validPw) {
      return;
    }

    if (!agreeTerms) {
      showToast('Please accept the terms to continue');
      return;
    }

    setLoading(true);

    try {
      if (typeof window !== 'undefined' && university) {
        localStorage.setItem('log2def_preferred_university', university);
      }
      await register({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        password_confirm: password,
      });
      showToast('Account created successfully');
    } catch (err: any) {
      setServerError(err.message || 'Registration failed. Please check your information.');
      showToast(err.message || 'Registration error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-root">
      <div className="shell">
        <main className="left">
          <Link className="logo" href="/">
            <div className="mark">L2D</div>
            Log2Def
          </Link>

          <div className="center">
            <div className="box">
              <form className="view on" id="signup" noValidate onSubmit={handleSubmit}>
                <h1>Start your report.</h1>
                <p className="lead">Create an account and turn your logbook into a defence-ready report.</p>

                <button
                  type="button"
                  className="google"
                  onClick={() => showToast('Connect Google sign-in here (demo)')}
                >
                  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.5 28.7A14.500 14.500 0 0 1 9.500 24c0-1.600.3-3.200.9-4.700l-7.900-6.100A24 24 0 0 0 0 24c0 3.900.9 7.500 2.600 10.800l7.900-6.100z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.600-5.900c-2.100 1.400-4.900 2.300-8.300 2.300-6.300 0-11.600-4.100-13.500-9.800l-7.900 6.100C6.500 42.600 14.600 48 24 48z"
                    />
                  </svg>
                  Sign up with Google
                </button>

                <div className="or">or sign up with email</div>

                {serverError && (
                  <div
                    style={{
                      marginBottom: '16px',
                      padding: '12px 14px',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(194, 65, 12, 0.08)',
                      border: '1px solid var(--red)',
                      color: 'var(--red)',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    {serverError}
                  </div>
                )}

                <div className={`f ${nameError ? 'bad' : ''}`}>
                  <label htmlFor="su-n">Full name</label>
                  <div className="in">
                    <input
                      id="su-n"
                      placeholder="As it appears on your logbook"
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        if (nameError) setNameError(false);
                      }}
                      onBlur={() => {
                        if (fullName) setNameError(fullName.trim().length === 0);
                      }}
                    />
                  </div>
                  <div className="err">Enter your full name.</div>
                </div>

                <div className="f">
                  <label htmlFor="su-u">University</label>
                  <div className="in sel">
                    <select
                      id="su-u"
                      value={university}
                      onChange={(e) => setUniversity(e.target.value)}
                    >
                      <option value="LASUSTECH">LASUSTECH</option>
                      <option value="Another Nigerian university">Another Nigerian university</option>
                      <option value="Polytechnic or college">Polytechnic or college</option>
                    </select>
                  </div>
                </div>

                <div className={`f ${emailError ? 'bad' : ''}`}>
                  <label htmlFor="su-e">Email</label>
                  <div className="in">
                    <input
                      id="su-e"
                      type="email"
                      placeholder="you@lasustech.edu.ng"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (emailError) setEmailError(false);
                      }}
                      onBlur={() => {
                        if (email) setEmailError(!isValidEmail(email));
                      }}
                    />
                  </div>
                  <div className="err">Enter a valid email address.</div>
                </div>

                <div className={`f ${passwordError ? 'bad' : ''}`}>
                  <label htmlFor="su-p">Password</label>
                  <div className="in">
                    <input
                      id="su-p"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Create a password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (passwordError) setPasswordError(false);
                      }}
                      onBlur={() => {
                        if (password) {
                          setPasswordError(
                            !(password.length >= 8 && /[a-z]/i.test(password) && /\d/.test(password))
                          );
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="eye"
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <div className="err">Use at least 8 characters with a letter and a number.</div>
                  <div className="meter" id="m1" data-s={getPasswordScore(password)}>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                </div>

                <label className="chk">
                  <input
                    type="checkbox"
                    id="su-t"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                  />
                  I agree to the terms and privacy policy, and I’ll verify all generated content before submission.
                </label>

                <button className={`btn ${loading ? 'load' : ''}`} type="submit" disabled={loading}>
                  <span className="sp"></span>
                  <span className="t">{loading ? 'Creating account...' : 'Create account'}</span>
                </button>

                <p className="alt">
                  Already have an account? <Link href="/login">Sign in</Link>
                </p>
              </form>
            </div>
          </div>

          <div className="foot">
            <span>© 2026 Log2Def</span>
            <span>Independent app, not an official LASUSTECH portal.</span>
          </div>
        </main>

        {/* Right Decorative Panel */}
        <aside className="right" aria-hidden="true">
          <div className="scene">
            <div className="pg p1">
              <b>Wk 3, Mon: rewired the distribution board with the technician.</b>
              <b>Tue: tested earthing.</b>
            </div>
            <div className="pg p2">
              <h4>3.2 Weekly activities</h4>
              <s></s>
              <s style={{ width: '90%' }}></s>
              <s style={{ width: '96%' }}></s>
              <s style={{ width: '64%' }}></s>
              <s style={{ width: '88%' }}></s>
              <em>Defence-ready</em>
            </div>
          </div>
          <h2>Your logbook, organised. Your defence, rehearsed.</h2>
          <p>Real entries in, a structured five-chapter report out. Nothing invented along the way.</p>
        </aside>
      </div>

      {/* Floating Status Toast */}
      <div
        id="toast"
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
          translate: toastVisible ? '-50% 0' : '-50% 20px',
          opacity: toastVisible ? 1 : 0,
          transition: '0.4s',
          background: '#14201b',
          color: '#fff',
          padding: '13px 20px',
          borderRadius: '99px',
          fontWeight: 600,
          fontSize: '14px',
          pointerEvents: 'none',
          zIndex: 99,
        }}
      >
        {toastMessage}
      </div>
    </div>
  );
}
