import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

const TOTAL_ROUNDS = 7
const TIME_PER_QUESTION = 15

const ROASTS = {
  blowout: [
    "That wasn\u2019t a competition, that was a documentary about natural selection.",
    "One of you brought a brain. The other brought vibes.",
    "This is the intellectual equivalent of bringing a spoon to a sword fight.",
  ],
  close: [
    "Basically a coin flip between two equally questionable intellects.",
    "The margin was so thin, neither of you should brag.",
  ],
  tie: [
    "Two brains, one shared brain cell.",
    "Perfectly balanced. Perfectly mid.",
  ],
}

const WAITING_TEASERS = [
  { q: "I have cities but no houses, forests but no trees. What am I?", a: "A map" },
  { q: "What has a head and a tail but no body?", a: "A coin" },
  { q: "The more you take, the more you leave behind. What am I?", a: "Footsteps" },
  { q: "What gets wetter the more it dries?", a: "A towel" },
  { q: "What word is spelled incorrectly in every dictionary?", a: "Incorrectly" },
  { q: "What has many keys but cannot open a single lock?", a: "A piano" },
  { q: "What month has 28 days?", a: "All of them" },
]

const WAITING_TAUNTS = [
  "Warming up those neurons? You are gonna need them.",
  "The average Dumb Friend score is 104. Just saying.",
  "90% of players think they will win. 50% are wrong.",
  "Someone is about to be called smooth brain.",
  "The questions get harder. The roasts get worse.",
]

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join('')
}

function calcScore(correct, ms) {
  if (!correct) return 0
  return 100 + Math.max(0, Math.round((15 - ms / 1000) * 3))
}

function calcIQ(score, correct, total, avgSec) {
  return Math.round(85 + (correct / total) * 50 + Math.max(0, (15 - avgSec) * 2))
}

export default function App() {
  const [screen, setScreen] = useState('loading')
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)

  const [authMode, setAuthMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [gameId, setGameId] = useState(null)
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [opponentName, setOpponentName] = useState('Friend')
  const [currentRound, setCurrentRound] = useState(0)
  const [currentQuestion, setCurrentQuestion] = useState(null)
  const [timer, setTimer] = useState(TIME_PER_QUESTION)
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [myScore, setMyScore] = useState(0)
  const [opScore, setOpScore] = useState(0)
  const [myCorrect, setMyCorrect] = useState(0)
  const [opCorrect, setOpCorrect] = useState(0)
  const [countdown, setCountdown] = useState(3)
  const [myIQ, setMyIQ] = useState(null)
  const [opIQ, setOpIQ] = useState(null)
  const [roastText, setRoastText] = useState('')

  const [waitContent, setWaitContent] = useState(null)
  const [teaserShown, setTeaserShown] = useState(false)

  const questionsRef = useRef([])
  const timerRef = useRef(null)
  const qStartRef = useRef(0)
  const channelRef = useRef(null)
  const myAnsRef = useRef({ done: false, idx: null, ms: 15000 })
  const opAnsRef = useRef(null)
  const waitRef = useRef(null)
  const isP1Ref = useRef(false)
  const roundRef = useRef(0)
  const myScoreRef = useRef(0)
  const opScoreRef = useRef(0)
  const myCorrectRef = useRef(0)
  const opCorrectRef = useRef(0)
  const myTimesRef = useRef([])
  const opTimesRef = useRef([])
  const gameIdRef = useRef(null)
  const userRef = useRef(null)

  useEffect(() => { userRef.current = user }, [user])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUser(session.user); loadProfile(session.user.id) }
      else setScreen('auth')
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) { setUser(session.user); loadProfile(session.user.id) }
      else { setUser(null); setProfile(null); setScreen('auth') }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(uid) {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
    if (data) { setProfile(data); setScreen('home') }
    else setScreen('auth')
  }

  async function handleAuth() {
    setAuthError(''); setAuthLoading(true)
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username, display_name: username } } })
        if (error) throw error
        if (data.user && !data.session) setAuthError('Check your email to confirm!')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (e) { setAuthError(e.message) }
    setAuthLoading(false)
  }

  async function fetchQuestions() {
    const { data, error } = await supabase.from('questions').select('*').limit(200)
    if (error || !data || data.length === 0) return []
    const sh = (arr) => [...arr].sort(() => Math.random() - 0.5)
    const easy = sh(data.filter(q => q.difficulty === 1))
    const med = sh(data.filter(q => q.difficulty === 2))
    const hard = sh(data.filter(q => q.difficulty === 3))
    const picked = [...easy.slice(0, 2), ...med.slice(0, 3), ...hard.slice(0, 2)]
    if (picked.length < TOTAL_ROUNDS) {
      const rest = sh(data.filter(q => !picked.find(p => p.id === q.id)))
      while (picked.length < TOTAL_ROUNDS && rest.length > 0) picked.push(rest.shift())
    }
    return picked
  }

  async function createGame() {
    const code = genCode()
    setRoomCode(code)
    const qs = await fetchQuestions()
    if (qs.length === 0) { alert('Could not load questions. Check your database.'); return }
    questionsRef.current = qs
    const qIds = qs.map(q => q.id)
    const { data: game, error } = await supabase.from('games')
      .insert({ room_code: code, player1_id: user.id, question_ids: qIds, status: 'waiting' })
      .select().single()
    if (error) { alert('Failed to create game: ' + error.message); return }
    setGameId(game.id); gameIdRef.current = game.id; isP1Ref.current = true
    setScreen('lobby'); subscribe(game.id); startWaiting()
  }

  async function joinGame() {
    const code = joinCode.toUpperCase().trim()
    if (code.length !== 4) return
    const { data: game, error } = await supabase.from('games').select('*').eq('room_code', code).eq('status', 'waiting').single()
    if (error || !game) { alert('Room not found or already started'); return }
    const { data: qs } = await supabase.from('questions').select('*').in('id', game.question_ids)
    if (qs) {
      const ordered = game.question_ids.map(id => qs.find(q => q.id === id)).filter(Boolean)
      questionsRef.current = ordered
    }
    const { data: opProf } = await supabase.from('profiles').select('username').eq('id', game.player1_id).single()
    if (opProf) setOpponentName(opProf.username || 'Friend')
    await supabase.from('games').update({ player2_id: user.id, status: 'countdown' }).eq('id', game.id)
    setGameId(game.id); gameIdRef.current = game.id; setRoomCode(code); isP1Ref.current = false
    subscribe(game.id); beginCountdown()
  }

  function subscribe(gId) {
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    const ch = supabase.channel('game-' + gId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: 'id=eq.' + gId }, async (payload) => {
        const g = payload.new
        if (g.status === 'countdown' && isP1Ref.current) {
          if (g.player2_id) {
            const { data: p } = await supabase.from('profiles').select('username').eq('id', g.player2_id).single()
            if (p) setOpponentName(p.username || 'Friend')
          }
          beginCountdown()
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers', filter: 'game_id=eq.' + gId }, (payload) => {
        const ans = payload.new
        if (ans.player_id !== userRef.current?.id) {
          if (myAnsRef.current.done) doProcessRound(ans)
          else opAnsRef.current = ans
        }
      })
      .subscribe()
    channelRef.current = ch
  }

  function startWaiting() {
    rotateWait()
    waitRef.current = setInterval(() => { setTeaserShown(false); rotateWait() }, 5000)
  }
  function rotateWait() {
    if (Math.random() < 0.3) {
      setWaitContent({ type: 'taunt', text: WAITING_TAUNTS[Math.floor(Math.random() * WAITING_TAUNTS.length)] })
    } else {
      const t = WAITING_TEASERS[Math.floor(Math.random() * WAITING_TEASERS.length)]
      setWaitContent({ type: 'teaser', question: t.q, answer: t.a })
    }
  }

  function beginCountdown() {
    if (waitRef.current) clearInterval(waitRef.current)
    roundRef.current = 0; myScoreRef.current = 0; opScoreRef.current = 0
    myCorrectRef.current = 0; opCorrectRef.current = 0; myTimesRef.current = []; opTimesRef.current = []
    setMyScore(0); setOpScore(0); setMyCorrect(0); setOpCorrect(0); setCurrentRound(0)
    setCountdown(3); setScreen('countdown')
    let c = 3
    const iv = setInterval(() => {
      c--; setCountdown(c)
      if (c <= 0) { clearInterval(iv); doStartRound(0) }
    }, 800)
  }

  function doStartRound(idx) {
    const qs = questionsRef.current
    if (idx >= qs.length || idx >= TOTAL_ROUNDS) { doFinish(); return }
    const q = qs[idx]
    roundRef.current = idx; setCurrentRound(idx); setCurrentQuestion(q)
    setSelectedAnswer(null); setShowResult(false); setTimer(TIME_PER_QUESTION); setScreen('question')
    qStartRef.current = Date.now()
    myAnsRef.current = { done: false, idx: null, ms: 15000 }; opAnsRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); if (!myAnsRef.current.done) doSubmit(null); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  function doSubmit(idx) {
    if (myAnsRef.current.done) return
    const ms = Date.now() - qStartRef.current
    myAnsRef.current = { done: true, idx, ms }
    if (timerRef.current) clearInterval(timerRef.current)
    const q = questionsRef.current[roundRef.current]
    if (!q) return
    const correct = idx === q.correct_index
    const score = calcScore(correct, ms)
    setSelectedAnswer(idx); setShowResult(true)
    myScoreRef.current += score; setMyScore(myScoreRef.current)
    if (correct) { myCorrectRef.current++; setMyCorrect(myCorrectRef.current) }
    myTimesRef.current.push(ms / 1000)
    supabase.from('answers').insert({
      game_id: gameIdRef.current, player_id: userRef.current.id, question_id: q.id,
      round_number: roundRef.current, selected_index: idx, is_correct: correct,
      time_taken_ms: ms, score_earned: score,
    }).then(() => {})
    if (opAnsRef.current) { setTimeout(() => doProcessRound(opAnsRef.current), 600) }
    else {
      setTimeout(() => {
        if (!opAnsRef.current) {
          const ch = q.difficulty === 1 ? 0.7 : q.difficulty === 2 ? 0.5 : 0.3
          const oc = Math.random() < ch; const ot = 3000 + Math.random() * 9000
          doProcessRound({ is_correct: oc, time_taken_ms: ot, score_earned: calcScore(oc, ot), selected_index: oc ? q.correct_index : ((q.correct_index + 1) % 4) })
        }
      }, 3000)
    }
  }

  function doProcessRound(opAns) {
    opScoreRef.current += opAns.score_earned; setOpScore(opScoreRef.current)
    if (opAns.is_correct) { opCorrectRef.current++; setOpCorrect(opCorrectRef.current) }
    opTimesRef.current.push(opAns.time_taken_ms / 1000)
    setScreen('roundResult')
    const next = roundRef.current + 1
    setTimeout(() => doStartRound(next), 2000)
  }

  function doFinish() {
    const myAvg = myTimesRef.current.length > 0 ? myTimesRef.current.reduce((a, b) => a + b, 0) / myTimesRef.current.length : 10
    const opAvg = opTimesRef.current.length > 0 ? opTimesRef.current.reduce((a, b) => a + b, 0) / opTimesRef.current.length : 10
    const mIQ = calcIQ(myScoreRef.current, myCorrectRef.current, TOTAL_ROUNDS, myAvg)
    const oIQ = calcIQ(opScoreRef.current, opCorrectRef.current, TOTAL_ROUNDS, opAvg)
    setMyIQ(mIQ); setOpIQ(oIQ)
    const diff = Math.abs(mIQ - oIQ); const tie = mIQ === oIQ
    const cat = tie ? 'tie' : diff > 15 ? 'blowout' : 'close'
    setRoastText(ROASTS[cat][Math.floor(Math.random() * ROASTS[cat].length)])
    setScreen('results')
    if (gameIdRef.current) {
      supabase.from('games').update({
        status: 'completed',
        player1_score: isP1Ref.current ? myScoreRef.current : opScoreRef.current,
        player2_score: isP1Ref.current ? opScoreRef.current : myScoreRef.current,
        player1_iq: isP1Ref.current ? mIQ : oIQ, player2_iq: isP1Ref.current ? oIQ : mIQ,
        completed_at: new Date().toISOString(),
      }).eq('id', gameIdRef.current).then(() => {})
    }
  }

  function goHome() {
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    if (waitRef.current) clearInterval(waitRef.current)
    setScreen('home'); setGameId(null); gameIdRef.current = null; questionsRef.current = []
  }

  // ============ RENDER ============

  const IS = { background: '#16162a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '14px 16px', color: '#f0f0f5', fontSize: 15, outline: 'none', width: '100%' }

  if (screen === 'loading') return <div className="screen" style={{ justifyContent: 'center', alignItems: 'center' }}><div style={{ color: 'var(--muted)' }}>Loading...</div></div>

  if (screen === 'auth') return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 32 }}>
      <div>
        <div style={{ width: 72, height: 72, margin: '0 auto 16px', background: 'linear-gradient(135deg, #ff3366, #7c3aed)', borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, animation: 'pulse 3s ease-in-out infinite' }}>{"\uD83E\uDDE0"}</div>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, background: 'linear-gradient(135deg, #f0f0f5, #ff3366)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Dumb Friend</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: '#8888aa', marginTop: 6, letterSpacing: 1.5, textTransform: 'uppercase' }}>{"\u201CEveryone\u2019s got one. Prove it\u2019s not you.\u201D"}</div>
      </div>
      <div style={{ width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {authMode === 'signup' && <input style={IS} placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />}
        <input style={IS} placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        <input style={IS} placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAuth()} />
        {authError && <div style={{ color: '#ff3366', fontSize: 13 }}>{authError}</div>}
        <button className="btn-primary" onClick={handleAuth} disabled={authLoading}>{authLoading ? '...' : authMode === 'signup' ? 'Create Account' : 'Sign In'}</button>
        <button className="btn-secondary" onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError('') }}>
          {authMode === 'login' ? "Don\u2019t have an account? Sign up" : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  )

  if (screen === 'home') return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 40 }}>
      <div>
        <div style={{ width: 80, height: 80, margin: '0 auto 20px', background: 'linear-gradient(135deg, #ff3366, #7c3aed)', borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, animation: 'pulse 3s ease-in-out infinite' }}>{"\uD83E\uDDE0"}</div>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 36, background: 'linear-gradient(135deg, #f0f0f5, #ff3366)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1.1 }}>Dumb Friend</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: '#8888aa', marginTop: 8, letterSpacing: 2, textTransform: 'uppercase' }}>{"\u201CEveryone\u2019s got one\u201D"}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 300 }}>
        <button className="btn-primary" onClick={createGame}>{"\u26A1 Challenge a Friend"}</button>
        <button className="btn-secondary" onClick={() => setScreen('join')}>{"\uD83C\uDFAF Join Game"}</button>
        <button className="btn-secondary" onClick={() => supabase.auth.signOut()} style={{ fontSize: 13, padding: 12, color: '#44445a' }}>Sign Out ({profile?.username})</button>
      </div>
    </div>
  )

  if (screen === 'join') return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 32 }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 28, letterSpacing: 2 }}>ENTER ROOM CODE</div>
        <div style={{ fontSize: 13, color: '#8888aa', marginTop: 4 }}>Get the code from your friend</div>
      </div>
      <input style={{ background: '#16162a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 20, color: '#ffd60a', fontSize: 32, fontFamily: "'Space Mono', monospace", textAlign: 'center', letterSpacing: 8, width: 220, outline: 'none', textTransform: 'uppercase' }} maxLength={4} value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && joinGame()} autoFocus placeholder="____" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 300 }}>
        <button className="btn-primary" onClick={joinGame} disabled={joinCode.length !== 4}>Join Game</button>
        <button className="btn-secondary" onClick={goHome}>{"\u2190 Back"}</button>
      </div>
    </div>
  )

  if (screen === 'lobby') return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 28 }}>
      <div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: '#8888aa', letterSpacing: 1.5, textTransform: 'uppercase' }}>Room Code</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 36, fontWeight: 700, letterSpacing: 8, color: '#ffd60a', marginTop: 4 }}>{roomCode}</div>
        <div style={{ fontSize: 13, color: '#44445a', marginTop: 8 }}>Share this code with your friend</div>
      </div>
      <div style={{ background: '#0e0e1a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 20, padding: '24px 20px', width: '100%', maxWidth: 340, minHeight: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        {waitContent?.type === 'teaser' ? (<>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 2 }}>Brain Teaser</div>
          <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5 }}>{waitContent.question}</div>
          <div onClick={() => setTeaserShown(true)} style={{ fontSize: 14, color: teaserShown ? '#06d6a0' : '#44445a', fontWeight: 600, padding: '10px 20px', borderRadius: 10, background: teaserShown ? 'rgba(6,214,160,0.08)' : 'rgba(255,255,255,0.04)', border: '1px solid ' + (teaserShown ? 'rgba(6,214,160,0.2)' : 'rgba(255,255,255,0.08)'), cursor: 'pointer' }}>
            {teaserShown ? waitContent.answer : 'Tap to reveal'}
          </div>
        </>) : waitContent?.type === 'taunt' ? (<>
          <div style={{ fontSize: 16 }}>{"\uD83D\uDC80"}</div>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, color: '#ffd60a' }}>{waitContent.text}</div>
        </>) : <div style={{ color: '#44445a' }}>Preparing questions...</div>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>{[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#44445a', animation: 'dotPulse 1.4s ease-in-out infinite ' + (i * 0.2) + 's' }} />)}</div>
      <div style={{ fontSize: 14, color: '#8888aa' }}>Waiting for opponent...</div>
      <button className="btn-secondary" onClick={goHome} style={{ maxWidth: 200 }}>Cancel</button>
    </div>
  )

  if (screen === 'countdown') return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div key={countdown} style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 140, background: 'linear-gradient(135deg, #ff3366, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'countPop 0.6s ease both', lineHeight: 1 }}>{countdown}</div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 14, color: '#8888aa', textTransform: 'uppercase', letterSpacing: 3, marginTop: 16 }}>Get Ready</div>
    </div>
  )

  if (screen === 'question' && currentQuestion) {
    const q = currentQuestion; const keys = ['A','B','C','D']
    const progress = (currentRound / TOTAL_ROUNDS) * 100
    const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options
    return (
      <div className="screen" style={{ paddingTop: 20, gap: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16 }}>
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: '#8888aa' }}>{currentRound + 1} / {TOTAL_ROUNDS}</span>
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 15, fontWeight: 700, color: '#ff3366', animation: timer <= 5 ? 'timerFlash 0.5s ease infinite' : 'none' }}>{timer}s</span>
        </div>
        <div style={{ width: '100%', height: 4, background: '#0e0e1a', borderRadius: 2, overflow: 'hidden', marginBottom: 28 }}><div style={{ height: '100%', background: 'linear-gradient(90deg, #7c3aed, #ff3366)', borderRadius: 2, width: progress + '%', transition: 'width 0.3s' }} /></div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>{(q.category || '').replace(/_/g, ' ')}</div>
        <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4, marginBottom: 32, minHeight: 80 }}>{q.question_text}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
          {opts.map((opt, i) => {
            let bg = '#0e0e1a', bd = 'rgba(255,255,255,0.06)', kb = 'rgba(255,255,255,0.05)', kc = '#8888aa'
            if (showResult) {
              if (i === q.correct_index) { bg = 'rgba(6,214,160,0.15)'; bd = '#06d6a0'; kb = '#06d6a0'; kc = '#08080e' }
              else if (i === selectedAnswer) { bg = 'rgba(255,51,102,0.15)'; bd = '#ff3366'; kb = '#ff3366'; kc = 'white' }
            } else if (i === selectedAnswer) { bd = '#7c3aed'; bg = 'rgba(124,58,237,0.12)'; kb = '#7c3aed'; kc = 'white' }
            return (
              <button key={i} onClick={() => !showResult && doSubmit(i)} style={{ background: bg, border: '1.5px solid ' + bd, borderRadius: 16, padding: '18px 20px', fontSize: 15, fontWeight: 500, color: '#f0f0f5', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', cursor: showResult ? 'default' : 'pointer' }}>
                <span style={{ width: 32, height: 32, borderRadius: 10, background: kb, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, color: kc, flexShrink: 0 }}>{keys[i]}</span>
                <span>{opt}</span>
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0 10px', marginTop: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 10, height: 10, borderRadius: '50%', background: '#06d6a0' }} /><span style={{ fontSize: 13, fontWeight: 600, color: '#8888aa' }}>You</span><span style={{ fontFamily: "'Space Mono', monospace", fontSize: 15, fontWeight: 700 }}>{myScore}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontFamily: "'Space Mono', monospace", fontSize: 15, fontWeight: 700 }}>{opScore}</span><span style={{ fontSize: 13, fontWeight: 600, color: '#8888aa' }}>{opponentName}</span><div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff3366' }} /></div>
        </div>
      </div>
    )
  }

  if (screen === 'roundResult') {
    const q = currentQuestion; const correct = myAnsRef.current.idx === q?.correct_index
    const opts = q ? (typeof q.options === 'string' ? JSON.parse(q.options) : q.options) : []
    return (
      <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 20 }}>
        <div style={{ fontSize: 48 }}>{correct ? '\u2705' : '\u274C'}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: correct ? '#06d6a0' : '#ff3366' }}>{correct ? 'Correct!' : 'Wrong!'}</div>
        {q && <div style={{ fontSize: 14, color: '#8888aa' }}>The answer was: <strong style={{ color: '#f0f0f5' }}>{opts[q.correct_index]}</strong></div>}
        <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
          <div style={{ textAlign: 'center' }}><div style={{ fontFamily: "'Space Mono', monospace", fontSize: 24, fontWeight: 700, color: '#06d6a0' }}>{myScore}</div><div style={{ fontSize: 12, color: '#8888aa' }}>You</div></div>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: '#44445a', alignSelf: 'center' }}>VS</div>
          <div style={{ textAlign: 'center' }}><div style={{ fontFamily: "'Space Mono', monospace", fontSize: 24, fontWeight: 700, color: '#ff3366' }}>{opScore}</div><div style={{ fontSize: 12, color: '#8888aa' }}>{opponentName}</div></div>
        </div>
      </div>
    )
  }

  if (screen === 'results') {
    const tie = myIQ === opIQ; const won = myIQ > opIQ
    return (
      <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 24, paddingTop: 40, paddingBottom: 40 }}>
        <div style={{ fontSize: 56, animation: 'crownBounce 1s ease both' }}>{tie ? '\uD83E\uDD1D' : '\uD83D\uDC51'}</div>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 26, lineHeight: 1.3, maxWidth: 320 }}>
          {tie ? <span style={{ color: '#44445a' }}>{"It\u2019s a tie. Nobody wins."}</span> : (<>
            <span style={{ background: 'linear-gradient(135deg, #ffd60a, #ff9f43)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{won ? 'You' : opponentName}</span>
            {" is the "}<span style={{ color: '#06d6a0' }}>big brain</span><br />
            <span style={{ color: '#44445a' }}>{won ? opponentName : 'You'}</span>
            {" is the "}<span style={{ color: '#ff3366' }}>smooth brain</span>
          </>)}
        </div>
        <div style={{ fontSize: 15, color: '#8888aa', maxWidth: 300, lineHeight: 1.5, fontStyle: 'italic' }}>{'"' + roastText + '"'}</div>
        <div style={{ display: 'flex', gap: 24, width: '100%', maxWidth: 320 }}>
          {[{ l: 'You', iq: myIQ, c: myCorrect, w: won }, { l: opponentName, iq: opIQ, c: opCorrect, w: !won && !tie }].map((p, i) => (
            <div key={i} style={{ flex: 1, background: '#0e0e1a', border: '1px solid ' + (p.w ? 'rgba(255,214,10,0.3)' : 'rgba(255,255,255,0.06)'), borderRadius: 20, padding: '24px 16px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
              {p.w && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #ffd60a, #ff9f43)' }} />}
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{p.l}</div>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 42, color: p.w ? '#06d6a0' : '#ff3366' }}>{p.iq}</div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: '#44445a', textTransform: 'uppercase', letterSpacing: 1 }}>IQ Score</div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: '#8888aa', marginTop: 8 }}>{p.c}/{TOTAL_ROUNDS} correct</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 300, marginTop: 8 }}>
          <button style={{ background: 'linear-gradient(135deg, #ffd60a, #ff9f43)', border: 'none', color: '#08080e', fontWeight: 700, fontSize: 15, padding: 16, borderRadius: 14, cursor: 'pointer' }} onClick={() => {
            const t = 'I just IQ-checked my friend on Dumb Friend! I got ' + myIQ + ' IQ, they got ' + opIQ + '. Think you can beat me? ' + window.location.href
            if (navigator.share) navigator.share({ title: 'Dumb Friend', text: t }); else { navigator.clipboard.writeText(t); alert('Copied to clipboard!') }
          }}>{"\uD83D\uDCF8 Share Results"}</button>
          <button className="btn-primary" onClick={createGame}>{"\uD83D\uDD04 Rematch"}</button>
          <button className="btn-secondary" onClick={goHome}>Home</button>
        </div>
      </div>
    )
  }

  return <div className="screen" style={{ justifyContent: 'center', alignItems: 'center' }}><div style={{ color: '#44445a' }}>Loading...</div></div>
}
