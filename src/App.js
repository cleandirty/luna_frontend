// src/App.js

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import './App.css';

// --- Configuration ---
const API_BASE_URL = 'https://story-generator-1-kkin.onrender.com';

// --- Components ---
const EpisodeWorkbench = ({ 
    outputs, 
    beat, 
    onRegenerate, 
    onNextEpisode,
    onPreviousEpisode,
    isFirstEpisode,
    isLastEpisode,
    isLoading,
    activeTab,      // <-- Receives state as a prop
    setActiveTab    // <-- Receives function to change state as a prop
}) => {
  if (!beat || !outputs) return null;
  // The useState hook has been REMOVED from here. This is the fix.

  return (
    <div className="workbench-container">
      <div className="workbench-header">
        <h3>Episode {beat.beat_number}: {beat.beat_title}</h3>
        <div className="workbench-tabs">
          <button onClick={() => setActiveTab('narration')} className={activeTab === 'narration' ? 'active' : ''}>📖 Story</button>
          <button onClick={() => setActiveTab('plot')} className={activeTab === 'plot' ? 'active' : ''}>📝 Plot</button>
          <button onClick={() => setActiveTab('character')} className={activeTab === 'character' ? 'active' : ''}>👥 Character</button>
          <button onClick={() => setActiveTab('world')} className={activeTab === 'world' ? 'active' : ''}>🌍 World</button>
        </div>
      </div>
      <div className="workbench-content">
        <ReactMarkdown rehypePlugins={[rehypeRaw]}>{outputs[activeTab] || `Loading ${activeTab}...`}</ReactMarkdown>
      </div>
      <div className="workbench-actions">
          <button onClick={onPreviousEpisode} disabled={isLoading || isFirstEpisode} className="prev-button">← Previous Episode</button>
          <button onClick={onRegenerate} disabled={isLoading}>Rewrite this Episode</button>
          <button onClick={onNextEpisode} disabled={isLoading} className="next-button">
            {isLastEpisode ? 'Finish Series' : 'Next Episode →'}
          </button>
      </div>
    </div>
  );
};

function App() {
  // --- State Management (All hooks are at the top level) ---
  const [messages, setMessages] = useState([]);
  const [appPhase, setAppPhase] = useState('AWAITING_BLUEPRINT');
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [narrationStyle, setNarrationStyle] = useState('');
  const [availableStyles, setAvailableStyles] = useState([]);
  const [blueprint, setBlueprint] = useState({
    genre: null, setting: null, tone: null, raw_character_input: null, story_idea: null,
  });
  const [masterPlan, setMasterPlan] = useState(null);
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);
  const [workbenchOutputs, setWorkbenchOutputs] = useState(null);
  const [generatedEpisodes, setGeneratedEpisodes] = useState([]);
  const [activeTab, setActiveTab] = useState('narration'); // <-- HOOK IS CORRECTLY PLACED HERE
  const messagesEndRef = useRef(null);

  // --- Helper Functions ---
  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); };
  const addMessage = (text, role) => { setMessages(prev => [...prev, { text, role }]); };

  // --- Effects ---
  useEffect(scrollToBottom, [messages, workbenchOutputs]);

  useEffect(() => {
    const fetchStyles = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/v1/styles`);
        setAvailableStyles(response.data);
        if (response.data.length > 0) setNarrationStyle(response.data[0].id);
        addMessage('Hello! Let\'s create a story series. To start, describe your idea in the chat.', 'ai');
      } catch (error) { addMessage('**Error:** Could not connect to the AI server.', 'error'); }
    };
    fetchStyles();
  }, []);

  // --- API Logic ---
  const handleUserInput = async () => {
    if (!userInput.trim() || isLoading) return;
    addMessage(userInput, 'user');
    const currentUserInput = userInput;
    setUserInput('');
    setIsLoading(true);

    try {
      if (appPhase === 'AWAITING_BLUEPRINT') {
        const response = await axios.post(`${API_BASE_URL}/api/v1/blueprint/update`, { blueprint, new_message: currentUserInput });
        setBlueprint(response.data.blueprint);
        addMessage(response.data.ai_response_message, 'ai');
        const isComplete = Object.values(response.data.blueprint).every(val => val !== null && val !== '');
        if (isComplete) {
          addMessage('**Blueprint complete! Generating master plan...**', 'system');
          await generatePlan(response.data.blueprint);
        }
      } else if (appPhase === 'AWAITING_PLAN_REVIEW') {
        addMessage('**Revising plan...**', 'system');
        const reviseResponse = await axios.post(`${API_BASE_URL}/api/v1/plan/revise`, { master_throughline: masterPlan, user_feedback: currentUserInput });
        setMasterPlan(reviseResponse.data);
        addMessage('**Here is the revised plan:**', 'ai');
        addMessage(formatPlan(reviseResponse.data), 'plan');
      } else if (appPhase === 'AWAITING_EPISODE_INPUT') {
        addMessage('**Great input! Generating episode...**', 'system');
        await handleGenerateEpisode(currentEpisodeIndex, currentUserInput);
      }
    } catch (error) {
      addMessage(`**Error:** ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const generatePlan = async (finalBlueprint) => {
    setIsLoading(true);
    setLoadingMessage('Generating story plan...');
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/plan/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...finalBlueprint, narration_style: narrationStyle })
        });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const { value } = await reader.read();
        const line = decoder.decode(value).split('\n').find(l => l.trim());
        if (line) {
            const parsed = JSON.parse(line);
            if (parsed.status === 'completed') {
                const planArray = JSON.parse(parsed.data.text);
                setMasterPlan(planArray);
                addMessage('**Here is the full story plan. You can ask for changes, or click the button below to start.**', 'ai');
                addMessage(formatPlan(planArray), 'plan');
                setAppPhase('PLAN_REVIEW');
            } else { throw new Error(parsed.data?.text?.error || "Failed to get plan."); }
        }
    } catch (error) {
        addMessage(`**Error generating plan:** ${error.message}`, 'error');
        setAppPhase('AWAITING_BLUEPRINT');
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  };

  const askForEpisodeInput = async (index) => {
    setIsLoading(true);
    setLoadingMessage('Preparing next episode...');
    setWorkbenchOutputs(null);
    setCurrentEpisodeIndex(index);
    
    if (generatedEpisodes[index]) {
      viewEpisode(index);
      setIsLoading(false);
      setLoadingMessage('');
      return;
    }

    try {
        const beat = masterPlan[index];
        addMessage(`**Let's get ready for Episode ${beat.beat_number}: ${beat.beat_title}**\n\n> *${beat.summary}*`, 'system');
        const response = await axios.post(`${API_BASE_URL}/api/v1/episode/ask-question`, {
            master_throughline: masterPlan,
            current_episode_index: index,
            raw_character_input: blueprint.raw_character_input,
            previous_episode_summary: index > 0 ? generatedEpisodes[index - 1]?.narration : null,
        });
        addMessage(response.data.question, 'ai');
        setAppPhase('AWAITING_EPISODE_INPUT');
    } catch (error) {
        addMessage(`**Error:** Could not prepare the next episode. Generating with default plan.`, 'error');
        await handleGenerateEpisode(index, "continue");
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  };

  const handleGenerateEpisode = async (index, feedback) => {
    setIsLoading(true);
    setLoadingMessage(`Generating Episode ${index + 1}...`);
    let tempOutputs = { world: '', character: '', plot: '', narration: '' };
    setWorkbenchOutputs(tempOutputs);
    setActiveTab('narration');
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/episode/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              ...blueprint,
              narration_style: narrationStyle,
              current_episode_index: index,
              master_throughline: masterPlan,
              beat_clarification_input: (feedback?.toLowerCase() === 'continue' ? null : feedback),
              previous_episode_summary: index > 0 ? masterPlan[index - 1].summary : null,
          })
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.trim() !== '');
          for (const line of lines) {
              try {
                  const parsed = JSON.parse(line);
                  setLoadingMessage(`Agent complete: ${parsed.agent}`);
                  tempOutputs = { ...tempOutputs, [parsed.agent]: parsed.data.text };
                  setWorkbenchOutputs(tempOutputs);
              } catch (e) { console.error("JSON parsing error:", e); }
          }
      }
      
      const newGeneratedEpisodes = [...generatedEpisodes];
      newGeneratedEpisodes[index] = tempOutputs;
      setGeneratedEpisodes(newGeneratedEpisodes);

      setAppPhase('EPISODE_DISPLAY');
    } catch (error) {
      addMessage(`**Error generating episode:** ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };
  
  const handleRegenerate = () => {
    const feedback = prompt("What changes would you like for this episode? (Leave blank for no changes)");
    if (feedback !== null) handleGenerateEpisode(currentEpisodeIndex, feedback);
  }

  const handleNextEpisode = () => {
    const nextIndex = currentEpisodeIndex + 1;
    if (nextIndex < masterPlan.length) {
      askForEpisodeInput(nextIndex);
    } else {
      addMessage('**Congratulations, you have completed the series!**', 'ai');
      setWorkbenchOutputs(null);
      setAppPhase('COMPLETED');
    }
  }
  
  const handlePreviousEpisode = () => {
    const prevIndex = currentEpisodeIndex - 1;
    if (prevIndex >= 0) {
      viewEpisode(prevIndex);
    }
  }

  const viewEpisode = (index) => {
    setCurrentEpisodeIndex(index);
    setWorkbenchOutputs(generatedEpisodes[index]);
    setAppPhase('EPISODE_DISPLAY');
    setActiveTab('narration');
  }

  const formatPlan = (plan) => {
    if (!Array.isArray(plan)) return "Invalid plan format.";
    return plan.map(beat => `**Episode ${beat.beat_number}: ${beat.beat_title}**\n\n_${beat.summary}_`).join('\n\n---\n\n');
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>LUNA</h1>
        <div className="style-selector">
          <label htmlFor="style-select">Style:</label>
          <select id="style-select" value={narrationStyle} onChange={e => setNarrationStyle(e.target.value)} disabled={appPhase !== 'AWAITING_BLUEPRINT'}>
            {availableStyles.map(style => <option key={style.id} value={style.id}>{style.displayName}</option>)}
          </select>
        </div>
      </header>
      <main className="main-content">
        <div className="chat-and-workbench">
          <div className="chat-container">
            <div className="message-list">
              {messages.map((msg, index) => (
                <div key={index} className={`message-wrapper ${msg.role}`}>
                    <div className={`message-bubble`}>
                      <ReactMarkdown rehypePlugins={[rehypeRaw]}>{msg.text}</ReactMarkdown>
                    </div>
                </div>
              ))}
              {appPhase === 'PLAN_REVIEW' && masterPlan && (
                <div className="action-panel">
                  <button onClick={() => askForEpisodeInput(0)}>✨ Write Episode 1</button>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="input-area">
              <input 
                type="text" 
                value={userInput} 
                onChange={(e) => setUserInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleUserInput()}
                placeholder={
                  (appPhase === 'AWAITING_BLUEPRINT' || appPhase === 'AWAITING_PLAN_REVIEW' || appPhase === 'AWAITING_EPISODE_INPUT') 
                  ? 'Your instructions...' 
                  : 'Chat disabled. Use workbench buttons.'}
                disabled={isLoading || !['AWAITING_BLUEPRINT', 'AWAITING_PLAN_REVIEW', 'AWAITING_EPISODE_INPUT'].includes(appPhase)}
              />
              <button 
                onClick={handleUserInput} 
                disabled={isLoading || !['AWAITING_BLUEPRINT', 'AWAITING_PLAN_REVIEW', 'AWAITING_EPISODE_INPUT'].includes(appPhase)}>
                {isLoading ? 'Thinking...' : 'Send'}
              </button>
            </div>
          </div>
          {appPhase === 'EPISODE_DISPLAY' && (
            <EpisodeWorkbench 
              outputs={workbenchOutputs} 
              beat={masterPlan[currentEpisodeIndex]}
              onRegenerate={handleRegenerate}
              onNextEpisode={handleNextEpisode}
              onPreviousEpisode={handlePreviousEpisode}
              isFirstEpisode={currentEpisodeIndex === 0}
              isLastEpisode={currentEpisodeIndex === masterPlan.length - 1 && generatedEpisodes[masterPlan.length-1]}
              isLoading={isLoading}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          )}
        </div>
        {isLoading && loadingMessage && <div className="loading-banner">{loadingMessage}</div>}
      </main>
    </div>
  );
}

export default App;