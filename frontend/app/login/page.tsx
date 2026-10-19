'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { authApi } from '@/lib/api';
import '@/app/auth.css';

export default function LoginPage() {
  const { login } = useAuth();
  const [view, setView] = useState<'signin' | 'forgot' | 'reset'>('signin');

  // Sign In State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [emailError, setEmailError] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot Password State
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotEmailError, setForgotEmailError] = useState(false);
  const [forgotDone, setForgotDone] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  // Reset Password State
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetError, setResetError] = useState(false);
  const [matchError, setMatchError] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setToastVisible(true);
    setTimeout(() => {
      setToastVisible(false);
    }, 2800);
  };

  // Check URL hash and query params for direct view navigation (#forgot, #reset, ?token=...)
  useEffect(() => {
    const handleUrlState = () => {
      if (typeof window === 'undefined') return;
      const urlParams = new URLSearchParams(window.location.search);
      const qToken = urlParams.get('token');
      const qView = urlParams.get('view');
      const hash = window.location.hash.replace('#/', '').replace('#', '').split('?')[0];

      if (qToken) {
        setResetToken(qToken);
        setView('reset');
      } else if (qView === 'reset' || hash === 'reset') {
        setView('reset');
      } else if (qView === 'forgot' || hash === 'forgot') {
        setView('forgot');
      } else {
        setView('signin');
      }
    };

    handleUrlState();
    window.addEventListener('hashchange', handleUrlState);
    return () => window.removeEventListener('hashchange', handleUrlState);
  }, []);

  // Validation Helpers
  const isValidEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    const validEmail = isValidEmail(email.trim());
    const validPw = password.trim().length > 0;

    setEmailError(!validEmail);
    setPasswordError(!validPw);

    if (!validEmail || !validPw) {
      return;
    }

    setLoading(true);
    try {
      await login({ username: email.trim(), password });
      showToast('Signed in successfully');
    } catch (err: any) {
      setServerError(err.message || 'Login failed. Please check your credentials.');
      showToast(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = isValidEmail(forgotEmail.trim());
    setForgotEmailError(!valid);
    if (!valid) return;

    setLoading(true);
    try {
      const res = await authApi.requestPasswordReset(forgotEmail.trim());
      if (res.reset_token) {
        setResetToken(res.reset_token);
      }
      setForgotDone(true);
      showToast(res.detail || 'Reset link sent to ' + forgotEmail);
    } catch (err: any) {
      showToast(err.message || 'Failed to request password reset');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCountdown > 0) return;
    setResendCountdown(30);
    try {
      const res = await authApi.requestPasswordReset(forgotEmail.trim());
      if (res.reset_token) {
        setResetToken(res.reset_token);
      }
      showToast(res.detail || 'Reset link sent again');
    } catch (err: any) {
      showToast(err.message || 'Failed to resend reset link');
    }
    const timer = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Password score calculation
  const getPasswordScore = (p: string) => {
    let s = 0;
    if (p.length >= 8) s++;
    if (/[a-z]/i.test(p) && /\d/.test(p)) s++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p) && p.length >= 8) s++;
    return p ? Math.max(1, s) : 0;
  };

  const resetRules = {
    len: newPassword.length >= 8,
    let: /[a-z]/i.test(newPassword),
    num: /\d/.test(newPassword),
    sym: /[^A-Za-z0-9]/.test(newPassword),
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validPw = newPassword.length >= 8 && /[a-z]/i.test(newPassword) && /\d/.test(newPassword);
    const matches = newPassword === confirmPassword && confirmPassword.length > 0;

    setResetError(!validPw);
    setMatchError(!matches);

    if (!validPw || !matches) return;
    if (!resetToken.trim()) {
      showToast('Reset token is required to set a new password');
      return;
    }

    setLoading(true);
    try {
      const res = await authApi.confirmPasswordReset({
        token: resetToken.trim(),
        password: newPassword,
        password_confirm: confirmPassword,
      });
      setResetDone(true);
      showToast(res.detail || 'Password updated successfully');
    } catch (err: any) {
      showToast(err.message || 'Failed to update password');
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
              {/* SIGN IN VIEW */}
              {view === 'signin' && (
                <form className="view on" id="signin" noValidate onSubmit={handleSignInSubmit}>
                  <h1>Welcome back.</h1>
                  <p className="lead">Sign in to pick up your report where you left it.</p>

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
                    Continue with Google
                  </button>

                  <div className="or">or use your email</div>

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

                  <div className={`f ${emailError ? 'bad' : ''}`}>
                    <label htmlFor="si-e">Email</label>
                    <div className="in">
                      <input
                        id="si-e"
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
                    <label htmlFor="si-p">
                      <span>Password</span>
                      <a
                        href="#forgot"
                        onClick={(e) => {
                          e.preventDefault();
                          setView('forgot');
                          window.location.hash = '/forgot';
                        }}
                      >
                        Forgot password?
                      </a>
                    </label>
                    <div className="in">
                      <input
                        id="si-p"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Your password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (passwordError) setPasswordError(false);
                        }}
                        onBlur={() => {
                          if (password) setPasswordError(password.trim().length === 0);
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
                    <div className="err">Enter your password.</div>
                  </div>

                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={keepSignedIn}
                      onChange={(e) => setKeepSignedIn(e.target.checked)}
                    />
                    Keep me signed in on this device
                  </label>

                  <button className={`btn ${loading ? 'load' : ''}`} type="submit" disabled={loading}>
                    <span className="sp"></span>
                    <span className="t">{loading ? 'Signing in...' : 'Sign in'}</span>
                  </button>

                  <p className="alt">
                    New to Log2Def? <Link href="/register">Create an account</Link>
                  </p>
                </form>
              )}

              {/* FORGOT PASSWORD VIEW */}
              {view === 'forgot' && (
                <div className="view on" id="forgot">
                  {!forgotDone ? (
                    <form id="forgotForm" noValidate onSubmit={handleForgotSubmit}>
                      <a
                        className="back"
                        href="#signin"
                        onClick={(e) => {
                          e.preventDefault();
                          setView('signin');
                          window.location.hash = '/signin';
                        }}
                      >
                        ← Back to sign in
                      </a>
                      <h1>Forgot your password?</h1>
                      <p className="lead">
                        Enter the email you signed up with and we’ll send you a link to choose a new one.
                      </p>
                      <div className={`f ${forgotEmailError ? 'bad' : ''}`}>
                        <label htmlFor="fp-e">Email</label>
                        <div className="in">
                          <input
                            id="fp-e"
                            type="email"
                            placeholder="you@lasustech.edu.ng"
                            autoComplete="email"
                            value={forgotEmail}
                            onChange={(e) => {
                              setForgotEmail(e.target.value);
                              if (forgotEmailError) setForgotEmailError(false);
                            }}
                          />
                        </div>
                        <div className="err">Enter a valid email address.</div>
                      </div>
                      <button className={`btn ${loading ? 'load' : ''}`} type="submit" disabled={loading}>
                        <span className="sp"></span>
                        <span className="t">{loading ? 'Sending...' : 'Send reset link'}</span>
                      </button>
                      <p className="alt">
                        Remembered it?{' '}
                        <a
                          href="#signin"
                          onClick={(e) => {
                            e.preventDefault();
                            setView('signin');
                            window.location.hash = '/signin';
                          }}
                        >
                          Sign in
                        </a>
                      </p>
                    </form>
                  ) : (
                    <div id="forgotDone">
                      <div className="ico">✉</div>
                      <h1>Check your email.</h1>
                      <p className="lead">
                        If an account exists for <b id="sentTo">{forgotEmail}</b>, a reset link is on its way. It may take a minute, and it’s worth checking spam.
                      </p>
                      <a
                        className="btn"
                        href="#reset"
                        style={{ textDecoration: 'none' }}
                        onClick={(e) => {
                          e.preventDefault();
                          setView('reset');
                          window.location.hash = resetToken ? `/reset?token=${encodeURIComponent(resetToken)}` : '/reset';
                        }}
                      >
                        Open the link (demo)
                      </a>
                      <button
                        className="btn ghost"
                        id="resend"
                        type="button"
                        style={{ marginTop: '12px' }}
                        disabled={resendCountdown > 0}
                        onClick={handleResend}
                      >
                        {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend email'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* RESET PASSWORD VIEW */}
              {view === 'reset' && (
                <div className="view on" id="reset">
                  {!resetDone ? (
                    <form id="resetForm" noValidate onSubmit={handleResetSubmit}>
                      <h1>Choose a new password.</h1>
                      <p className="lead">Pick something you haven’t used on Log2Def before.</p>

                      <div className="f">
                        <label htmlFor="rp-tok">Reset Token</label>
                        <div className="in">
                          <input
                            id="rp-tok"
                            type="text"
                            required
                            placeholder="Enter or paste token from your email"
                            value={resetToken}
                            onChange={(e) => setResetToken(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className={`f ${resetError ? 'bad' : ''}`}>
                        <label htmlFor="rp-p">New password</label>
                        <div className="in">
                          <input
                            id="rp-p"
                            type={showNewPassword ? 'text' : 'password'}
                            placeholder="At least 8 characters"
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={(e) => {
                              setNewPassword(e.target.value);
                              if (resetError) setResetError(false);
                            }}
                          />
                          <button
                            type="button"
                            className="eye"
                            aria-pressed={showNewPassword}
                            onClick={() => setShowNewPassword(!showNewPassword)}
                          >
                            {showNewPassword ? 'Hide' : 'Show'}
                          </button>
                        </div>
                        <div className="err">Use at least 8 characters with a letter and a number.</div>
                        <div className="meter" id="m2" data-s={getPasswordScore(newPassword)}>
                          <i></i>
                          <i></i>
                          <i></i>
                          <i></i>
                        </div>
                        <ul className="rules" id="rules">
                          <li className={resetRules.len ? 'ok' : ''}>8+ characters</li>
                          <li className={resetRules.let ? 'ok' : ''}>A letter</li>
                          <li className={resetRules.num ? 'ok' : ''}>A number</li>
                          <li className={resetRules.sym ? 'ok' : ''}>A symbol</li>
                        </ul>
                      </div>

                      <div className={`f ${matchError ? 'bad' : ''}`}>
                        <label htmlFor="rp-c">Confirm password</label>
                        <div className="in">
                          <input
                            id="rp-c"
                            type="password"
                            placeholder="Type it again"
                            autoComplete="new-password"
                            value={confirmPassword}
                            onChange={(e) => {
                              setConfirmPassword(e.target.value);
                              if (matchError) setMatchError(false);
                            }}
                          />
                        </div>
                        <div className="err">The passwords don’t match.</div>
                      </div>

                      <button
                        className={`btn ${loading ? 'load' : ''}`}
                        type="submit"
                        style={{ marginTop: '8px' }}
                        disabled={loading}
                      >
                        <span className="sp"></span>
                        <span className="t">{loading ? 'Updating...' : 'Update password'}</span>
                      </button>
                    </form>
                  ) : (
                    <div id="resetDone">
                      <div className="ico">✓</div>
                      <h1>Password updated.</h1>
                      <p className="lead">You’re all set. Sign in with your new password to continue your report.</p>
                      <a
                        className="btn"
                        href="#signin"
                        style={{ textDecoration: 'none' }}
                        onClick={(e) => {
                          e.preventDefault();
                          setView('signin');
                          setResetDone(false);
                          setForgotDone(false);
                          setNewPassword('');
                          setConfirmPassword('');
                          window.location.hash = '/signin';
                        }}
                      >
                        Continue to sign in
                      </a>
                    </div>
                  )}
                </div>
              )}
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
