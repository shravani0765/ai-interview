/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Send, RefreshCw, Play, CheckCircle2, AlertCircle, User, Bot, Volume2, ChevronRight, BarChart3, BookOpen, Layout, Settings, History, ArrowLeft } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import questionsDataRaw from './data/questions.json';
const questionsData = questionsDataRaw as Question[];
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Helper for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Question {
  id: number;
  question: string;
  difficulty: 'easy' | 'medium' | 'hard';
  keywords: string[];
  answer: string;
  subject?: string;
}

interface Message {
  id: string;
  type: 'bot' | 'user' | 'system';
  content: string;
  timestamp: Date;
  evaluation?: {
    score: number;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
    correctAnswer: string;
  };
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SUBJECTS = [
  { id: 'HTML', name: 'HTML', icon: Layout, color: 'blue' },
  { id: 'DevOps', name: 'DevOps', icon: Settings, color: 'indigo' },
  { id: 'Cloud Computing', name: 'Cloud Computing', icon: History, color: 'sky' },
  { id: 'OS', name: 'Operating Systems', icon: BookOpen, color: 'cyan' },
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy');
  const [scores, setScores] = useState<number[]>([]);
  const [isInterviewStarted, setIsInterviewStarted] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [userId] = useState(() => `user_${Math.random().toString(36).substr(2, 9)}`);

  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const synthRef = useRef<SpeechSynthesis>(window.speechSynthesis);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        setTranscript(finalTranscript || interimTranscript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };
    }
  }, []);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Persistence: Save chat history
  useEffect(() => {
    if (isInterviewStarted && messages.length > 0) {
      fetch('/api/chat/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subject: selectedSubject, messages }),
      }).catch(err => console.error("Save error:", err));
    }
  }, [messages, isInterviewStarted, userId, selectedSubject]);

  const speak = useCallback((text: string) => {
    if (synthRef.current) {
      synthRef.current.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      synthRef.current.speak(utterance);
    }
  }, []);

  const startInterview = (subjectId: string) => {
    setSelectedSubject(subjectId);
    setIsInterviewStarted(true);
    
    const subjectQuestions = questionsData.filter(q => 
      subjectId === 'HTML' ? (!q.subject || q.subject === 'HTML') : q.subject === subjectId
    );
    
    const firstQuestion = subjectQuestions.find(q => q.difficulty === 'easy') || subjectQuestions[0];
    
    const welcomeMsg: Message = {
      id: Date.now().toString(),
      type: 'bot',
      content: `Welcome to your ${subjectId} Interview! I'll ask you a series of questions. Speak your answers clearly.`,
      timestamp: new Date(),
    };
    const questionMsg: Message = {
      id: (Date.now() + 1).toString(),
      type: 'bot',
      content: firstQuestion.question,
      timestamp: new Date(),
    };
    setMessages([welcomeMsg, questionMsg]);
    speak(welcomeMsg.content + " " + questionMsg.content);
    setCurrentQuestionIndex(questionsData.indexOf(firstQuestion));
  };

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
    } else {
      setTranscript('');
      recognitionRef.current?.start();
      setIsRecording(true);
    }
  };

  const evaluateAnswer = async (userAnswer: string) => {
    if (!userAnswer.trim()) return;

    setIsEvaluating(true);
    const currentQuestion = questionsData[currentQuestionIndex];

    const userMsg: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: userAnswer,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Evaluate this interview answer.
        Subject: ${selectedSubject}
        Question: ${currentQuestion.question}
        Expected Keywords: ${currentQuestion.keywords.join(', ')}
        Reference Answer: ${currentQuestion.answer}
        User Answer: ${userAnswer}

        Provide a score out of 10 and detailed feedback.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
              suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctAnswer: { type: Type.STRING },
            },
            required: ["score", "strengths", "weaknesses", "suggestions", "correctAnswer"],
          },
        },
      });

      const result = JSON.parse(response.text);
      setScores(prev => [...prev, result.score]);

      const botFeedback: Message = {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        content: `Evaluation complete. Score: ${result.score}/10.`,
        timestamp: new Date(),
        evaluation: result,
      };

      setMessages(prev => [...prev, botFeedback]);
      speak(`Score: ${result.score}. ${result.score >= 7 ? "Well done." : "Keep going."}`);

      // Adaptive Difficulty Logic
      const avgScore = [...scores, result.score].reduce((a, b) => a + b, 0) / (scores.length + 1);
      let nextDifficulty = difficulty;
      if (avgScore > 8) nextDifficulty = 'hard';
      else if (avgScore > 6) nextDifficulty = 'medium';
      else nextDifficulty = 'easy';
      setDifficulty(nextDifficulty);

      setTimeout(() => {
        askNextQuestion(nextDifficulty);
      }, 3000);

    } catch (error) {
      console.error("Evaluation error:", error);
      askNextQuestion(difficulty);
    } finally {
      setIsEvaluating(false);
      setTranscript('');
    }
  };

  const askNextQuestion = (targetDifficulty: string) => {
    const subjectQuestions = questionsData.filter(q => 
      selectedSubject === 'HTML' ? (!q.subject || q.subject === 'HTML') : q.subject === selectedSubject
    );

    const availableQuestions = subjectQuestions.filter(q => 
      !messages.some(m => m.content === q.question)
    );
    
    const nextQ = availableQuestions.find(q => q.difficulty === targetDifficulty) || availableQuestions[0];

    if (nextQ) {
      const questionMsg: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: nextQ.question,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, questionMsg]);
      speak(nextQ.question);
      setCurrentQuestionIndex(questionsData.indexOf(nextQ));
    } else {
      const endMsg: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: "Interview completed! You've answered all questions for this subject.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, endMsg]);
      speak(endMsg.content);
    }
  };

  const handleSend = () => {
    if (transcript.trim()) {
      evaluateAnswer(transcript);
    }
  };

  const changeSubject = () => {
    setIsInterviewStarted(false);
    setSelectedSubject(null);
    setMessages([]);
    setScores([]);
    setDifficulty('easy');
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-slate-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-100">
            <Bot size={24} />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight text-slate-800">AI Interview</h1>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Active Session</span>
            </div>
          </div>
        </div>
        
        {isInterviewStarted && (
          <div className="flex items-center gap-3">
            <button 
              onClick={changeSubject}
              className="hidden sm:flex items-center gap-2 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors border border-slate-200"
            >
              <ArrowLeft size={14} className="text-slate-500" />
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Change Subject</span>
            </button>
            <div className="px-3 py-1.5 bg-blue-50 rounded-lg text-[10px] font-bold text-blue-600 uppercase tracking-widest border border-blue-100">
              {difficulty}
            </div>
          </div>
        )}
      </header>

      <main className="max-w-4xl mx-auto p-4 sm:p-6 h-[calc(100vh-80px)] flex flex-col">
        {!isInterviewStarted ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-12 py-12">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <h2 className="text-5xl sm:text-6xl font-black tracking-tight text-slate-900">
                Ready for your <span className="text-blue-600">Interview?</span>
              </h2>
              <p className="text-slate-500 max-w-lg mx-auto text-lg font-medium">
                Select a topic to start your AI-powered voice interview session.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-3xl">
              {SUBJECTS.map((subject) => (
                <motion.button
                  key={subject.id}
                  whileHover={{ scale: 1.02, y: -4 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => startInterview(subject.id)}
                  className="group relative bg-white p-8 rounded-3xl border border-slate-200 text-left shadow-sm hover:shadow-xl hover:shadow-blue-500/5 hover:border-blue-200 transition-all"
                >
                  <div className={cn(
                    "w-14 h-14 rounded-2xl flex items-center justify-center mb-6 transition-colors",
                    `bg-${subject.color}-50 text-${subject.color}-600 group-hover:bg-blue-600 group-hover:text-white`
                  )}>
                    <subject.icon size={28} />
                  </div>
                  <h3 className="text-xl font-bold text-slate-800 mb-2">{subject.name}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    {subject.id === 'HTML' ? '200+ Questions' : '5 Core Questions'} covering essential placement topics.
                  </p>
                  <div className="absolute top-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronRight className="text-blue-600" />
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto space-y-8 pb-32 scrollbar-hide px-2">
              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className={cn(
                      "flex gap-4 max-w-[90%]",
                      msg.type === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                    )}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center shadow-sm",
                      msg.type === 'bot' ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                    )}>
                      {msg.type === 'bot' ? <Bot size={20} /> : <User size={20} />}
                    </div>
                    
                    <div className="space-y-3">
                      <div className={cn(
                        "p-5 rounded-2xl text-[15px] leading-relaxed shadow-sm border",
                        msg.type === 'bot' ? "bg-white border-slate-100 text-slate-800" : "bg-blue-600 border-blue-500 text-white"
                      )}>
                        {msg.content}
                      </div>

                      {msg.evaluation && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="bg-slate-50 border border-slate-200 rounded-3xl p-6 space-y-6 shadow-sm"
                        >
                          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Analysis Report</span>
                            <div className="flex items-center gap-2 bg-blue-600 px-3 py-1 rounded-full">
                              <span className="text-xs font-black text-white">{msg.evaluation.score}/10</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-600 flex items-center gap-2">
                                <CheckCircle2 size={14} /> Key Strengths
                              </h4>
                              <ul className="text-sm text-slate-600 space-y-2">
                                {msg.evaluation.strengths.map((s, i) => <li key={i} className="flex gap-2"><span>•</span> {s}</li>)}
                              </ul>
                            </div>
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-black uppercase tracking-widest text-rose-500 flex items-center gap-2">
                                <AlertCircle size={14} /> Improvements
                              </h4>
                              <ul className="text-sm text-slate-600 space-y-2">
                                {msg.evaluation.weaknesses.map((w, i) => <li key={i} className="flex gap-2"><span>•</span> {w}</li>)}
                              </ul>
                            </div>
                          </div>

                          <div className="pt-4 border-t border-slate-200">
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Model Answer</h4>
                            <p className="text-sm text-slate-500 font-medium leading-relaxed italic">
                              "{msg.evaluation.correctAnswer}"
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {/* Change Subject Card in between */}
              {messages.length > 4 && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="max-w-sm mx-auto bg-blue-50 border border-blue-100 rounded-3xl p-6 text-center space-y-4 my-8"
                >
                  <h4 className="font-bold text-blue-800">Want to try another topic?</h4>
                  <p className="text-xs text-blue-600/70">You can switch subjects anytime to broaden your preparation.</p>
                  <button 
                    onClick={changeSubject}
                    className="w-full py-3 bg-white text-blue-600 rounded-2xl font-bold text-sm shadow-sm hover:shadow-md transition-all border border-blue-200"
                  >
                    Switch Subject
                  </button>
                </motion.div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-white via-white/95 to-transparent pointer-events-none">
              <div className="max-w-4xl mx-auto w-full pointer-events-auto">
                <div className="relative bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl shadow-blue-900/5 p-3 flex items-center gap-3">
                  <button
                    onClick={toggleRecording}
                    className={cn(
                      "w-14 h-14 rounded-full flex items-center justify-center transition-all",
                      isRecording ? "bg-rose-500 text-white animate-pulse" : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                    )}
                  >
                    {isRecording ? <MicOff size={24} /> : <Mic size={24} />}
                  </button>
                  
                  <div className="flex-1 px-2">
                    {isRecording ? (
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1 items-center">
                          {[1,2,3,4].map(i => (
                            <motion.div
                              key={i}
                              animate={{ height: [10, 24, 10] }}
                              transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                              className="w-1 bg-blue-500 rounded-full"
                            />
                          ))}
                        </div>
                        <span className="text-sm text-slate-400 font-medium italic truncate">
                          {transcript || "Listening to your answer..."}
                        </span>
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={transcript}
                        onChange={(e) => setTranscript(e.target.value)}
                        placeholder="Speak or type your response..."
                        className="w-full bg-transparent border-none focus:ring-0 text-slate-700 font-medium placeholder:text-slate-300"
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                      />
                    )}
                  </div>

                  <button
                    onClick={handleSend}
                    disabled={isEvaluating || !transcript.trim()}
                    className={cn(
                      "w-14 h-14 rounded-full flex items-center justify-center transition-all",
                      transcript.trim() && !isEvaluating ? "bg-blue-600 text-white shadow-xl shadow-blue-200" : "bg-slate-50 text-slate-200 cursor-not-allowed"
                    )}
                  >
                    {isEvaluating ? <RefreshCw size={24} className="animate-spin" /> : <Send size={24} />}
                  </button>
                </div>
                
                <div className="mt-4 flex justify-center gap-8">
                   <div className="flex items-center gap-2">
                      <Volume2 size={16} className="text-slate-300" />
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">Voice Feedback Active</span>
                   </div>
                   <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">AI Expert Connected</span>
                   </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
