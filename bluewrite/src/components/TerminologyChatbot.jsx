import React, { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import assistantAvatar from '../assets/Friendly AI Police Assistant Badge.png';
import './TerminologyChatbot.css';

const EXAMPLES = ['Probable cause', 'Chain of custody', 'Warrant of arrest'];

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function TerminologyChatbot({ open, onOpen, onClose }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [minimized, setMinimized] = useState(false);
  const input = useRef(null);
  const transcript = useRef(null);
  const inFlight = useRef(false);
  const id = useId();

  useEffect(() => {
    if (open && !minimized) input.current?.focus();
  }, [open, minimized]);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages, busy, open, minimized]);

  async function send(event) {
    event.preventDefault();
    const text = question.trim();
    if (!text || [...text].length > 300 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      // Only this question leaves the browser. No roles, history, or case context.
      const answer = await api('/ai/terminology', { method: 'POST', body: { message: text } });
      const at = new Date().toISOString();
      setMessages((rows) => [...rows, { role: 'user', text, at }, { role: 'assistant', text: answer.reply, at }].slice(-40));
      setQuestion('');
    } catch (err) {
      setError(err.message || 'Could not get a reply. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <div className="terminology-dock">
      {open ? (
        <section className={`terminology-chat${minimized ? ' is-minimized' : ''}`} aria-labelledby={`${id}-title`}>
          <header className="terminology-chat__head">
            <img className="terminology-chat__avatar" src={assistantAvatar} alt="" width="40" height="40" />
            <div className="terminology-chat__identity">
              <h2 id={`${id}-title`}>BlueWrite</h2>
              <p>Police terminology</p>
            </div>
            <div className="terminology-chat__actions">
              <button type="button" onClick={() => setMinimized((v) => !v)} aria-label={minimized ? 'Expand chatbot' : 'Minimize chatbot'} aria-expanded={!minimized}>{minimized ? '+' : '−'}</button>
              <button type="button" onClick={onClose} aria-label="Close chatbot">×</button>
            </div>
          </header>
          {!minimized && (
            <>
              <p className="terminology-chat__notice">Questions go to AI, not case records. No names or case details.</p>
              <div className="terminology-chat__transcript" ref={transcript} role="log" aria-label="Terminology conversation" aria-live="polite" aria-relevant="additions">
                {messages.length === 0 && (
                  <div className="terminology-chat__welcome">
                    <h3>What would you like to know?</h3>
                    <div className="terminology-chat__examples">
                      {EXAMPLES.map((example) => <button key={example} type="button" onClick={() => { setQuestion(example); input.current?.focus(); }}>{example}</button>)}
                    </div>
                  </div>
                )}
                {messages.map((message, i) => (
                  <div key={i} className={`terminology-chat__line is-${message.role}`}>
                    {message.role === 'assistant' && <img className="terminology-chat__avatar terminology-chat__avatar--reply" src={assistantAvatar} alt="" width="28" height="28" />}
                    <div className="terminology-chat__column">
                      <div className={`terminology-chat__message is-${message.role}`}>
                        {message.role === 'assistant' && <span>BlueWrite Assistant</span>}
                        <p>{message.text}</p>
                      </div>
                      <time className="terminology-chat__time" dateTime={message.at}>{formatTime(message.at)}</time>
                    </div>
                  </div>
                ))}
              </div>
              {busy && <p className="terminology-chat__status" role="status">Checking the term…</p>}
              {error && <p className="terminology-chat__error" role="alert">{error}</p>}
              <form className="terminology-chat__form" onSubmit={send}>
                <label className="sr-only" htmlFor={`${id}-question`}>Ask about a police term</label>
                <div>
                  <input id={`${id}-question`} ref={input} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="Ask about a police term…" disabled={busy} autoComplete="off" />
                  <button type="submit" aria-label="Send" title="Send" disabled={busy || !question.trim()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg></button>
                </div>
                <footer>
                  <span>{question.length > 0 ? `${[...question].length}/300` : 'English · Tagalog · Bisaya'}</span>
                  {messages.length > 0 && <button type="button" disabled={busy} onClick={() => { setMessages([]); setError(''); input.current?.focus(); }}>Clear chat</button>}
                </footer>
              </form>
            </>
          )}
        </section>
      ) : (
        <button className="terminology-launcher" type="button" onClick={() => { setMinimized(false); onOpen?.(); }} aria-label="Open police terminology chatbot">Ask BlueWrite</button>
      )}
    </div>
  );
}
