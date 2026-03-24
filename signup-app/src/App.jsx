import React, { useState, useEffect, useRef } from 'react';
import Dashboard from './Dashboard';
import './index.css';

const simulateApiCall = (time = 1000, shouldSucceed = true) => 
  new Promise((res, rej) => setTimeout(shouldSucceed ? res : rej, time));

// Global tracking utility calling Express backend
let globalSecureToken = null;

const trackStep = async (stepName, userEmail = null) => {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (globalSecureToken) {
        headers['Authorization'] = `Bearer ${globalSecureToken}`;
    }

    const res = await fetch('http://localhost:5000/api/track', {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
          event: stepName, 
          email: userEmail,
          deviceType: navigator.userAgent 
      })
    });
    if (!res.ok) throw new Error('Server returned ' + res.status);
  } catch (err) {
    console.warn("Backend not reachable, falling back to localStorage");
    const current = JSON.parse(localStorage.getItem('signup_metrics')) || {
      started: 1042,
      completed_step1: 856,
      completed_step2: 512,
      completed_step3: 420
    };
    current[stepName] = (current[stepName] || 0) + 1;
    localStorage.setItem('signup_metrics', JSON.stringify(current));
  }
};

export default function OptimizedSignupFlow() {
  const [view, setView] = useState('signup'); // 'signup' or 'dashboard'

  // If in dashboard mode, render the dashboard
  if (view === 'dashboard') {
    return <Dashboard onBack={() => setView('signup')} />;
  }

  // Otherwise, render Signup Flow
  return <SignupApp onViewDashboard={() => setView('dashboard')} />;
}

function SignupApp({ onViewDashboard }) {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // 1. Establish secure JWT session on mount to authenticate analytics requests
    fetch('http://localhost:5000/api/start-session')
        .then(res => res.json())
        .then(data => {
            if (data.token) {
                globalSecureToken = data.token;
                trackStep('started');
            }
        })
        .catch(err => {
            console.error("Failed to secure JWT session", err);
            trackStep('started'); 
        });
  }, []);

  const [email, setEmail] = useState('');
  useEffect(() => {
    const savedEmail = localStorage.getItem('signup_partial_email');
    if (savedEmail) {
      setEmail(savedEmail);
    }
  }, []);

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    localStorage.setItem('signup_partial_email', e.target.value);
  };

  const [emailError, setEmailError] = useState('');
  const validateEmail = () => {
    if (!email) {
      setEmailError('Email is required');
      return false;
    }
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    setEmailError(isValid ? '' : 'Please enter a valid email address');
    return isValid;
  };

  const [password, setPassword] = useState('');
  
  const hasLength = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const isPasswordValid = hasLength && hasNumber;

  const [otp, setOtp] = useState('');
  const [actualOtp, setActualOtp] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [otpStalled, setOtpStalled] = useState(false);
  const [showBot, setShowBot] = useState(false);
  const [hasDismissedBot, setHasDismissedBot] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastInteraction, setLastInteraction] = useState(Date.now());
  const otpInputRef = useRef(null);

  // 1. Auto-save state to localStorage
  useEffect(() => {
    if (step > 0 && step < 4) {
      localStorage.setItem('signup_persistence', JSON.stringify({ email, step }));
    }
  }, [email, step]);

  // 2. Initial state recovery
  useEffect(() => {
    const saved = localStorage.getItem('signup_persistence');
    if (saved) {
      const { email: savedEmail, step: savedStep } = JSON.parse(saved);
      setEmail(savedEmail);
      setStep(savedStep);
    }
    
    // Initial fetch for session token
    fetch('http://localhost:5000/api/start-session')
        .then(res => res.json())
        .then(data => {
            if (data.token) {
                globalSecureToken = data.token;
                trackStep('started');
            }
        });
  }, []);

  // 3. AI Chatbot Inactivity Detection (20 seconds)
  useEffect(() => {
    if (step === 4 || hasDismissedBot) return; // Don't show on dashboard or if dismissed
    
    const interval = setInterval(() => {
      if (Date.now() - lastInteraction > 20000 && !showBot) {
        setShowBot(true);
        trackStep('bot_triggered', email);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [lastInteraction, showBot, step, email, hasDismissedBot]);

  const resetInactivity = () => {
    setLastInteraction(Date.now());
    if (showBot) setShowBot(false);
  };

  const triggerHelp = () => {
      setShowBot(true);
      trackStep('help_requested', email);
  };

  const dismissBot = () => {
    setShowBot(false);
    setHasDismissedBot(true);
    trackStep('bot_dismissed', email);
  };

  const getHelpContent = () => {
      switch(step) {
          case 1: return "Having trouble with your email? Make sure it follows the standard format (e.g., name@domain.com).";
          case 2: return "Passwords need to be secure. We recommend at least 8 characters with a mix of letters and symbols.";
          case 3: return "OTP delayed? It usually arrives within 60 seconds. Make sure to check your 'Promotions' or 'Spam' folders!";
          default: return "How can I help you today?";
      }
  };

  const speakHelp = () => {
      if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel(); // Stop any current speech
          const text = getHelpContent();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.onstart = () => setIsSpeaking(true);
          utterance.onend = () => setIsSpeaking(false);
          window.speechSynthesis.speak(utterance);
          trackStep('voice_help_used', email);
      } else {
          alert("Sorry, your browser doesn't support voice synthesis.");
      }
  };

  const handleSSOLogin = async (provider) => {
      resetInactivity();
      setIsLoading(true);
      try {
          await simulateApiCall(1500); 
          trackStep('completed_sso', email); // Track successful fast-path
          alert(`Successfully authenticated with ${provider}!`);
          onViewDashboard();
      } catch (e) {
          console.error(`${provider} SSO Error`, e);
      } finally {
          setIsLoading(false);
      }
  };

  const handleNextStep1 = async () => {
    if (!validateEmail()) return;
    setIsLoading(true);
    try {
      await simulateApiCall(500); 
      trackStep('completed_step1', email);
      setStep(2);
      resetInactivity();
    } catch (e) {
      setEmailError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleNextStep2 = async () => {
    if (!isPasswordValid) return;
    setIsLoading(true);
    try {
      await simulateApiCall(800);
      trackStep('completed_step2', email); // Track successful step 2
      setStep(3);
      resetInactivity();
      
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      setActualOtp(code);
      
      try {
        const mailRes = await fetch('http://localhost:5000/api/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp: code })
        });
        if (mailRes.ok) {
            const data = await mailRes.json();
            if (data.previewUrl) {
                setPreviewUrl(data.previewUrl);
                setShowToast(true);
            }
        } else {
             setTimeout(() => setShowToast(true), 1500);
        }
      } catch(e) {
         console.warn("Mail server failed", e);
         setTimeout(() => setShowToast(true), 1500);
      }

      setTimeout(() => otpInputRef.current?.focus(), 100); 
    } catch (e) {
      console.error("Failed to send OTP", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinalSignup = async () => {
    if (otp.length < 6) return;
    setIsLoading(true);
    try {
      await simulateApiCall(1000);
      if (otp !== actualOtp) {
        alert("Invalid OTP! Try the code from the notification.");
        setIsLoading(false);
        return;
      }

      trackStep('completed_step3', email); // Track successful step 3 completion
      localStorage.removeItem('signup_partial_email');
      setShowToast(false);
      alert("Signup Complete! Welcome.");
      
      // Optionally route them to dashboard automatically on complete for demo
      onViewDashboard();
    } catch (e) {
      console.error("OTP Invalid", e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="signup-container">
      <div className="progress-bar" style={{ marginTop: 24 }}>
        <div className="progress-fill" style={{ width: `${(step / 3) * 100}%` }}></div>
      </div>
      <p className="step-indicator">Step {step} of 3</p>

      <h2>Create your account</h2>

      {/* Persistent Help Trigger */}
      {step < 4 && !showBot && (
        <button className="help-trigger-btn fade-in" onClick={triggerHelp} title="Need help?">
          <span>❓</span>
        </button>
      )}

      {/* AI Chatbot Intervention */}
      {showBot && (
        <div className="bot-overlay fade-in">
          <div className="bot-bubble">
            <div className="bot-header">
              <span className="bot-icon">🤖</span>
              <strong>AI Assistant</strong>
              <button className="close-bot" onClick={dismissBot}>×</button>
            </div>
            <div className="bot-body">
              <p><strong>{step < 4 ? "Step " + step + " Help" : "Assistant"}</strong></p>
              <p>{getHelpContent()}</p>
              <div className="bot-actions" style={{ flexDirection: 'column' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, width: '100%' }}>
                  <button className="btn-sm" style={{ flex: 1 }} onClick={speakHelp}>
                    {isSpeaking ? '🔊 Speaking...' : '🔈 Read Aloud'}
                  </button>
                  <button className="btn-sm btn-outline" style={{ flex: 1 }} onClick={dismissBot}>Got it</button>
                </div>
                <button className="btn-sm btn-text" style={{ fontSize: 11, padding: 0 }} onClick={() => { alert("A support ticket has been simulated!"); dismissBot(); }}>
                  Request human agent
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="form-step fade-in">
          <div className="social-logins">
            <button className="btn-social google" onClick={() => handleSSOLogin('Google')} disabled={isLoading}>
                Continue with Google
            </button>
            <button className="btn-social apple" onClick={() => handleSSOLogin('Apple')} disabled={isLoading}>
                Continue with Apple
            </button>
          </div>
          
          <div className="divider"><span>or use email</span></div>

          <label>Email Address</label>
          <input 
            type="email" 
            value={email} 
            onChange={handleEmailChange}
            onBlur={validateEmail}
            placeholder="you@example.com"
            disabled={isLoading}
          />
          {emailError && <span className="error-text">{emailError}</span>}
          
          <button 
            className="btn-primary" 
            onClick={handleNextStep1} 
            disabled={isLoading || !email}
          >
            {isLoading ? 'Checking...' : 'Continue'}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="form-step fade-in">
          <label>Create a Password</label>
          <input 
            type="password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={isLoading}
          />
          
          <ul className="password-rules">
            <li className={hasLength ? 'valid' : ''}>
              {hasLength ? '✅' : '❌'} At least 8 characters
            </li>
            <li className={hasNumber ? 'valid' : ''}>
              {hasNumber ? '✅' : '❌'} Contains a number
            </li>
          </ul>

          <button 
            className="btn-primary" 
            onClick={handleNextStep2} 
            disabled={isLoading || !isPasswordValid}
          >
            {isLoading ? 'Sending Code...' : 'Create Account'}
          </button>
          <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
        </div>
      )}

      {step === 3 && (
        <div className="form-step fade-in">
          <label>Enter verification code sent to {email}</label>
          <input 
            ref={otpInputRef}
            type="text" 
            value={otp} 
            autoComplete="one-time-code" 
            inputMode="numeric"
            maxLength={6}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="000000"
            disabled={isLoading}
          />
          
          <button 
            className="btn-primary" 
            onClick={handleFinalSignup} 
            disabled={isLoading || otp.length < 6}
          >
            {isLoading ? 'Verifying...' : 'Verify & Complete'}
          </button>
          
          {otpStalled ? (
            <div className="fallback-wedge fade-in" style={{marginTop: 24, padding: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12}}>
              <p style={{fontSize: 13, color: '#c9d1d9', textAlign: 'center', marginBottom: 16, fontWeight: 500}}>
                ⏳ SMS taking too long? Skip the wait:
              </p>
              <button className="btn-secondary" style={{marginBottom: 12, width: '100%', borderColor: '#58a6ff', color: '#58a6ff'}} onClick={() => {
                  trackStep('fallback_magic_link_used', email);
                  alert('Magic Link securely dispatched to ' + email + '!');
                  onViewDashboard();
              }}>
                  ✉️ Send Magic Link to Email
              </button>
              <button className="btn-social google" style={{marginBottom: 0}} onClick={() => handleSSOLogin('Google')}>
                  Continue with Google instead
              </button>
            </div>
          ) : (
             <button className="btn-text">Didn't receive it? Resend in 30s</button>
          )}
        </div>
      )}

      {showToast && (
        <div className="toast-notification fade-in">
          <div className="toast-icon">📧</div>
          <div className="toast-content" style={{width: '100%'}}>
            <strong>Email Sent!</strong>
            {previewUrl ? (
                <>
                <p>We've emailed your code to <b>{email}</b>.</p>
                <a href={previewUrl} target="_blank" rel="noreferrer" style={{color: '#58a6ff', fontSize: 13, marginTop: 4, display: 'inline-block'}}>
                    Click here to open email (Ethereal demo)
                </a>
                </>
            ) : (
                <p onClick={() => { setOtp(actualOtp); setShowToast(false); }} style={{cursor: 'pointer'}}>
                    Your verification code is: <b>{actualOtp}</b> (Tap to autofill)
                </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
