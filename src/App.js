// src/App.js

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import './App.css';

// --- Configuration ---
const API_BASE_URL = 'http://localhost:8000';

// --- Initial State Definition ---
const INITIAL_STORY_STATE = {
  genre: null, setting: null, tone: null, raw_character_input: null, story_idea: null,
  character_bible: null, world_bible: null, master_throughline: null,
  completed_episodes: [],
  current_episode_index: 0,
  conversation_history: [],
  narration_style: "default_contemporary.txt",
  app_phase: "BLUEPRINT_COLLECTION",
};

// --- Helper to format AI thinking steps for the chat ---
const formatToolMessage = (msg) => {
  if (!msg.tool_calls || msg.tool_calls.length === 0) return msg.content;
  const toolName = msg.tool_calls[0].function.name;
  const messages = {
    update_blueprint_tool: `[AI is updating the story blueprint...]`,
    create_series_bibles_tool: `[AI is creating the World and Character Bibles...]`,
    generate_initial_plan_tool: `[AI is drafting the story plan...]`,
    revise_plan_summary_tool: `[AI is revising the plan based on your feedback...]`,
    ask_strategic_question_for_next_episode_tool: `[AI is thinking of a strategic question...]`,
    generate_episode_tool: `[AI is generating the episode...]`,
  };
  return messages[toolName] || `[AI is using the ${toolName} tool...]`;
};


// --- Components ---
const Workbench = ({ 
    storyState,
    viewingIndex,
    onNavigate,
    isLoading
}) => {
  const [activeTab, setActiveTab] = useState('throughline');
  
  useEffect(() => {
    if (storyState.completed_episodes.length > viewingIndex) {
        setActiveTab('story');
    }
  }, [viewingIndex, storyState.completed_episodes.length]);
  
  const currentBeat = storyState.master_throughline ? storyState.master_throughline[viewingIndex] : null;
  const hasCompletedEpisodes = storyState.completed_episodes.length > 0;

  const TABS = {
    throughline: { label: '📜 Throughline', content: storyState.master_throughline ? storyState.master_throughline.map(b => `**Ep ${b.beat_number}: ${b.beat_title}**\n\n${b.summary}`).join('\n\n---\n\n') : 'The master plan has not been generated yet.' },
    story: { label: '📖 Story', content: hasCompletedEpisodes ? storyState.completed_episodes[viewingIndex] : "No episodes have been generated yet." },
    character: { label: '👥 Character Bible', content: storyState.character_bible || "The Character Bible has not been generated yet." },
    world: { label: '🌍 World Bible', content: storyState.world_bible || "The World Bible has not been generated yet." },
    plot: { label: '📝 Plot', content: "Note: Per-episode plot display is a planned enhancement." },
  };

  const isFirstEpisode = viewingIndex === 0;
  const isLastEpisode = viewingIndex === storyState.completed_episodes.length - 1;

  return (
    <div className="workbench-container">
      <div className="workbench-header">
        {activeTab === 'story' && currentBeat ? 
          <h3>Episode {currentBeat.beat_number}: {currentBeat.beat_title}</h3> :
          <h3>{TABS[activeTab].label}</h3>
        }
        <div className="workbench-tabs">
          {Object.keys(TABS).map(tabKey => {
            if (!hasCompletedEpisodes && (tabKey === 'story' || tabKey === 'plot')) {
              return null;
            }
            return (
              <button key={tabKey} onClick={() => setActiveTab(tabKey)} className={activeTab === tabKey ? 'active' : ''}>
                {TABS[tabKey].label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="workbench-content">
        <ReactMarkdown rehypePlugins={[rehypeRaw]}>
          {TABS[activeTab].content}
        </ReactMarkdown>
      </div>
      {activeTab === 'story' && hasCompletedEpisodes && (
        <div className="workbench-actions">
            <button onClick={() => onNavigate(-1)} disabled={isLoading || isFirstEpisode}>← Previous</button>
            <button onClick={() => onNavigate(1)} disabled={isLoading || isLastEpisode}>Next →</button>
        </div>
      )}
    </div>
  );
};

function App() {
  const [storyState, setStoryState] = useState(INITIAL_STORY_STATE);
  const [viewingEpisodeIndex, setViewingEpisodeIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [availableStyles, setAvailableStyles] = useState([]);
  
  const messagesEndRef = useRef(null);
  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); };
  useEffect(scrollToBottom, [storyState.conversation_history]);

  useEffect(() => {
    const fetchStylesAndInit = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/v1/styles`);
        setAvailableStyles(response.data);
        const firstStyle = response.data.length > 0 ? response.data[0].id : "default_contemporary.txt";
        
        if (storyState.conversation_history.length === 0) {
          const initialState = {
            ...INITIAL_STORY_STATE,
            narration_style: firstStyle,
            conversation_history: [{ role: 'assistant', content: "Hello! Let's create a story. Please describe your idea." }]
          };
          setStoryState(initialState);
        }
      } catch (error) { 
        const historyWithError = [...storyState.conversation_history, { role: 'assistant', content: '**Error:** Could not connect to the AI server. Please ensure the backend is running and refresh.' }];
        setStoryState(prev => ({...prev, conversation_history: historyWithError }));
      }
    };
    fetchStylesAndInit();
  }, []);
  
  useEffect(() => {
      if (storyState.completed_episodes.length > 0) {
        setViewingEpisodeIndex(storyState.completed_episodes.length - 1);
      }
  }, [storyState.completed_episodes.length]);

  const sendChatMessage = async (userMessage) => {
    setIsLoading(true);
    
    const updatedHistory = [...storyState.conversation_history];
    if (userMessage) {
        updatedHistory.push({ role: 'user', content: userMessage });
    }
    
    const stateToSend = { ...storyState, conversation_history: updatedHistory };
    setStoryState(stateToSend);
    setUserInput('');

    try {
      const response = await axios.post(`${API_BASE_URL}/api/v1/chat`, stateToSend);
      setStoryState(response.data);
    } catch (error) {
      const historyWithError = [...updatedHistory, { role: 'error', content: `**Error:** ${error.response?.data?.detail || error.message}` }];
      setStoryState(prev => ({...prev, conversation_history: historyWithError }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = () => {
    if (!userInput.trim() || isLoading) return;
    sendChatMessage(userInput);
  };
  
  const handleNarrationStyleChange = (e) => {
    setStoryState(prev => ({ ...prev, narration_style: e.target.value }));
  };

  const handleWorkbenchNavigate = (direction) => {
      const newIndex = viewingEpisodeIndex + direction;
      if (newIndex >= 0 && newIndex < storyState.completed_episodes.length) {
          setViewingEpisodeIndex(newIndex);
      }
  }

  const showWorkbench = storyState.world_bible && storyState.character_bible;

  return (
    <div className="App">
      <header className="App-header">
        <h1>StoryForge AI</h1>
        <div className="style-selector">
          <label htmlFor="style-select">Style:</label>
          <select id="style-select" value={storyState.narration_style} onChange={handleNarrationStyleChange} disabled={!!storyState.master_throughline}>
            {availableStyles.map(style => <option key={style.id} value={style.id}>{style.displayName}</option>)}
          </select>
        </div>
      </header>
      <main className="main-content">
        <div className="chat-and-workbench">
          <div className="chat-container">
            <div className="message-list">
              {storyState.conversation_history.map((msg, index) => {
                let content = msg.content;
                let role = msg.role;
                
                if (role === 'assistant' && msg.tool_calls) {
                  content = formatToolMessage(msg);
                  role = 'tool';
                }
                
                if (role === 'user' || role === 'assistant' || role === 'error' || role === 'system' || role === 'tool') {
                  return (
                    <div key={index} className={`message-wrapper ${role}`}>
                        <div className="message-bubble">
                          <ReactMarkdown rehypePlugins={[rehypeRaw]}>{content}</ReactMarkdown>
                        </div>
                    </div>
                  );
                }
                return null;
              })}
              <div ref={messagesEndRef} />
            </div>
            <div className="input-area">
              <input 
                type="text" 
                value={userInput} 
                onChange={(e) => setUserInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={isLoading ? "AI is thinking..." : "Your instructions..."}
                disabled={isLoading}
              />
              <button onClick={handleSendMessage} disabled={isLoading}>
                {isLoading ? 'Thinking...' : 'Send'}
              </button>
            </div>
          </div>
          {showWorkbench && (
            <Workbench 
              storyState={storyState}
              viewingIndex={viewingEpisodeIndex}
              onNavigate={handleWorkbenchNavigate}
              isLoading={isLoading}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;