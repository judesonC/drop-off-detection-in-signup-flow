import React, { useEffect, useState } from 'react';
import './index.css';

export default function Dashboard({ onBack }) {
  const [metrics, setMetrics] = useState({
    started: 0,
    completed_step1: 0,
    completed_step2: 0,
    completed_step3: 0,
    completed_sso: 0,
    otp_stall_detected: 0,
    fallback_magic_link_used: 0,
    bot_triggered: 0
  });

  useEffect(() => {
    fetch('http://localhost:5000/api/metrics')
      .then(res => {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.json();
      })
      .then(data => {
        if (data.started !== undefined) setMetrics(data);
      })
      .catch(err => {
         console.warn("Backend unreachable, loading localStorage fallback");
         const data = JSON.parse(localStorage.getItem('signup_metrics')) || {
           started: 1042, completed_step1: 856, completed_step2: 512, completed_step3: 420, completed_sso: 150, otp_stall_detected: 85, fallback_magic_link_used: 42, bot_triggered: 124
         };
         setMetrics(data);
      });
  }, []);

  const totalCompleted = (metrics.completed_step3 || 0) + (metrics.completed_sso || 0) + (metrics.fallback_magic_link_used || 0);

  const totalOauth = (metrics.completed_sso || 0) + (metrics.fallback_magic_link_used || 0);

  const data = [
    { label: 'Started (Landed on Signup)', count: metrics.started },
    { label: 'Completed Step 1 (Email)', count: metrics.completed_step1 },
    { label: 'Completed Step 2 (Password)', count: metrics.completed_step2 },
    { label: 'Completed Step 3 (Verified)', count: metrics.completed_step3 }
  ];

  const max = Math.max(...data.map(d => d.count), 1); 

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>Signup Funnel Analytics</h2>
        <button className="btn-secondary btn-sm" onClick={onBack}>← Back to App</button>
      </div>

      <div className="metrics-cards" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="card">
          <h3>Total Signups</h3>
          <p className="card-value">{totalCompleted}</p>
        </div>
        <div className="card">
          <h3>Smart Fallbacks</h3>
          <p className="card-value">{totalOauth}</p>
        </div>
        <div className="card">
          <h3>OTP Stalls</h3>
          <p className="card-value alert-text">{metrics.otp_stall_detected || 0}</p>
        </div>
        <div className="card">
          <h3>Completion Rate</h3>
          <p className="card-value">
            {Math.round((totalCompleted / (metrics.started || 1)) * 100)}<span className="percent">%</span>
          </p>
        </div>
      </div>

      <div className="funnel-chart">
        {data.map((item, index) => {
          const percentage = Math.round((item.count / max) * 100);
          
          let dropOff = 0;
          if (index > 0) {
            const prevCount = data[index - 1].count;
            dropOff = prevCount ? Math.round(((prevCount - item.count) / prevCount) * 100) : 0;
          }

          return (
            <div key={index} className="funnel-row fade-in" style={{ animationDelay: `${index * 0.1}s` }}>
              <div className="funnel-label">
                <span className="funnel-title">{item.label}</span>
                <span className="funnel-count">
                  {item.count} users ({percentage}%)
                  {dropOff > 0 && <span className="dropoff-badge">-{dropOff}% off previous</span>}
                </span>
              </div>
              <div className="funnel-bar-bg">
                <div 
                  className={`funnel-bar-fill step-color-${index}`} 
                  style={{ width: `${percentage}%` }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
