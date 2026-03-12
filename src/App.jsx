import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

// ============================================================
// CONSTANTS
// ============================================================
const TOTAL_ROUNDS = 7
const TIME_PER_QUESTION = 15

const ROASTS = {
  blowout: [
    "That wasn't a competition, that was a documentary about natural selection.",
    "One of you brought a brain. The other brought vibes.",
    "This is the intellectual equivalent of bringing a spoon to a sword fight.",
    "Someone call an ambulance — not for the loser, for their dignity.",
  ],
  close: [
    "Basically a coin flip between two equally questionable intellects.",
    "The margin was so thin, neither of you should brag.",
    "This close? You're basically the same flavor of average.",
  ],
  tie: [
    "Two brains, one shared brain cell.",
    "Perfectly balanced. Perfectly mid.",
    "Either you're both geniuses or both got lucky. We know which.",
  ],
}

const WAITING_TEASERS = [
  { q: "I have cities but no houses, forests but no trees. What am I?", a: "A map" },
  { q: "What has a head and a tail but no body?", a: "A coin" },
  { q: "The more you take, the more you leave behind. What am I?", a: "Footsteps" },
  { q: "What gets wetter the more it dries?", a: "A towel" },
  { q: "What word is spelled incorrectly in every dictionary?", a: "Incorrectly" },
  { q: "Forward I'm heavy, backward I'm not. What am I?", a: "The word 'ton'" },
  { q: "What has many keys but can't open a single lock?", a: "A piano" },
  { q: "What month has 28 days?", a: "All of them" },
]

const WAITING_TAUNTS = [
  "Warming up those neurons? You're gonna need them.",
  "The average Dumb Friend score is 104. Just saying.",
  "Fun fact: 90% of players think they'll win. 50% are wrong.",
  "Someone's about to be called smooth brain. Don't let it be you.",
  "The questions get harder. The roasts get worse.",
  "Pro tip: if you're confident in your answer, you're probably falling for it.",
]

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

function calcScore(isCorrect, timeMs) {
  if (!isCorrect) return 0
  const timeSec = timeMs / 1000
  return 100 + Math.max(0, Math.round((15 - timeSec) * 3))
}

function calcIQ(totalScore, correct, total, avgTimeSec) {
  const accuracy = correct / total
  const speedBonus = Math.max(0, (15 - avgTimeSec) * 2)
  return Math.round(85 + accuracy * 50 + speedBonus)
}

// ============================================================
// APP
// ============================================================
export default function App() {
  const [screen, setScreen] = useState('auth') // auth, home, create, join, lobby, countdown, question, roundResult, results
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)

  // Auth state
  const [authMode, setAuthMode] = useState('login') // login or signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  // Game state
  const [gameId, setGameId] = useState(null)
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [opponent, setOpponent] = useState(null)
  const [questions, setQuestions] = useState([])
  const [currentRound, setCurrentRound] = useState(0)
  const [currentQuestion, setCurrentQuestion] = useState(null)
  const [timer, setTimer] = useState(TIME_PER_QUESTION)
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [myScore, setMyScore] = useState(0)
  const [opScore, setOpScore] = useState(0)
  const [myCorrect, setMyCorrect] = useState(0)
  const [opCorrect, setOpCorrect] = useState(0)
  const [myTimes, setMyTimes] = useState([])
  const [opTimes, setOpTimes] = useState([])
  const [countdown, setCountdown] = useState(3)
  const [roundResults, setRoundResults] = useState([])
  const [myIQ, setMyIQ] = useState(null)
  const [opIQ, setOpIQ] = useState(null)

  // Waiting room
  const [waitingContent, setWaitingContent] = useState(null)
  const [teaserRevealed, setTeaserRevealed] = useState(false)

  // Refs
  const timerRef = useRef(null)
  const questionStartRef = useRef(0)
  const channelRef = useRef(null)
  const myAnswerRef = useRef({ submitted: false, index: null, timeMs: 15000 })
  const opAnswerRef = useRef(null)
  const waitingIntervalRef = useRef(null)
  const isPlayer1Ref = useRef(false)

  // ============================================================
  // AUTH
  // ============================================================
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        loadProfile(session.user.id)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user)
        loadProfile(session.user.id)
      } else {
        setUser(null)
        setProfile(null)
        setScreen('auth')
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (data) {
      setProfile(data)
      setScreen('home')
    }
  }

  async function handleAuth() {
    setAuthError('')
    setAuthLoading(true)
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username, display_name: username }
          }
        })
        if (error) throw error
        // For dev: auto-confirm might be on. If not, show confirmation message.
        if (data.user && !data.session) {
          setAuthError('Check your email for a confirmation link!')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setAuthError(err.message)
    }
    setAuthLoading(false)
  }

  // ============================================================
  // CREATE GAME
  // ============================================================
  async function createGame() {
    const code = generateCode()
    setRoomCode(code)

    // Fetch random questions
    const { data: qs } = await supabase
      .from('questions')
      .select('*')
      .eq('is_active', true)
      .limit(100)

    if (!qs || qs.length < TOTAL_ROUNDS) {
      // Fallback: get any questions
      const { data: fallback } = await supabase.from('questions').select('*').limit(100)
      if (!fallback) return
      const shuffled = fallback.sort(() => Math.random() - 0.5).slice(0, TOTAL_ROUNDS)
      setQuestions(shuffled)
    } else {
      // Difficulty ramp: 2 easy, 3 medium, 2 hard
      const easy = qs.filter(q => q.difficulty === 1).sort(() => Math.random() - 0.5)
      const med = qs.filter(q => q.difficulty === 2).sort(() => Math.random() - 0.5)
      const hard = qs.filter(q => q.difficulty === 3).sort(() => Math.random() - 0.5)

      const selected = [
        ...(easy.slice(0, 2)),
        ...(med.slice(0, 3)),
        ...(hard.slice(0, 2)),
      ]
      // Fill gaps if not enough in a difficulty
      while (selected.length < TOTAL_ROUNDS) {
        const remaining = qs.filter(q => !selected.includes(q)).sort(() => Math.random() - 0.5)
        if (remaining.length > 0) selected.push(remaining[0])
        else break
      }
      setQuestions(selected)
    }

    // Create game record
    const { data: game, error } = await supabase
      .from('games')
      .insert({
        room_code: code,
        player1_id: user.id,
        question_ids: [],
        status: 'waiting',
      })
      .select()
      .single()

    if (error) { console.error(error); return }

    setGameId(game.id)
    isPlayer1Ref.current = true
    setScreen('lobby')
    subscribeToGame(game.id)
    startWaitingContent()
  }

  // ============================================================
  // JOIN GAME
  // ============================================================
  async function joinGame() {
    const code = joinCode.toUpperCase().trim()
    if (code.length !== 4) return

    const { data: game, error } = await supabase
      .from('games')
      .select('*')
      .eq('room_code', code)
      .eq('status', 'waiting')
      .single()

    if (error || !game) {
      alert('Room not found or already started')
      return
    }

    // Update game with player2
    await supabase
      .from('games')
      .update({
        player2_id: user.id,
        status: 'countdown',
      })
      .eq('id', game.id)

    // Load opponent profile
    const { data: opProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', game.player1_id)
      .single()

    setOpponent(opProfile)
    setGameId(game.id)
    setRoomCode(code)
    isPlayer1Ref.current = false

    // Fetch questions (same as creator)
    const { data: qs } = await supabase
      .from('questions')
      .select('*')
      .eq('is_active', true)
      .limit(100)

    if (qs) {
      const easy = qs.filter(q => q.difficulty === 1).sort(() => Math.random() - 0.5)
      const med = qs.filter(q => q.difficulty === 2).sort(() => Math.random() - 0.5)
      const hard = qs.filter(q => q.difficulty === 3).sort(() => Math.random() - 0.5)
      const selected = [...easy.slice(0, 2), ...med.slice(0, 3), ...hard.slice(0, 2)]
      while (selected.length < TOTAL_ROUNDS) {
        const remaining = qs.filter(q => !selected.includes(q)).sort(() => Math.random() - 0.5)
        if (remaining.length > 0) selected.push(remaining[0])
        else break
      }
      setQuestions(selected)
    }

    subscribeToGame(game.id)
    startCountdown()
  }

  // ============================================================
  // REALTIME SUBSCRIPTION
  // ============================================================
  function subscribeToGame(gId) {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel(`game:${gId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${gId}`,
      }, (payload) => {
        const game = payload.new
        if (game.status === 'countdown') {
          // Opponent joined
          loadOpponent(game)
          startCountdown()
        }
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'answers',
        filter: `game_id=eq.${gId}`,
      }, (payload) => {
        const answer = payload.new
        if (answer.player_id !== user?.id) {
          opAnswerRef.current = answer
          // If we already submitted, process round
          if (myAnswerRef.current.submitted) {
            processRound(answer)
          }
        }
      })
      .subscribe()

    channelRef.current = channel
  }

  async function loadOpponent(game) {
    const opId = isPlayer1Ref.current ? game.player2_id : game.player1_id
    if (opId) {
      const { data } = await supabase.from('profiles').select('*').eq('id', opId).single()
      if (data) setOpponent(data)
    }
  }

  // ============================================================
  // WAITING ROOM CONTENT
  // ============================================================
  function startWaitingContent() {
    rotateWaitingContent()
    waitingIntervalRef.current = setInterval(() => {
      setTeaserRevealed(false)
      rotateWaitingContent()
    }, 6000)
  }

  function rotateWaitingContent() {
    const isTaunt = Math.random() < 0.3
    if (isTaunt) {
      setWaitingContent({
        type: 'taunt',
        text: WAITING_TAUNTS[Math.floor(Math.random() * WAITING_TAUNTS.length)]
      })
    } else {
      const t = WAITING_TEASERS[Math.floor(Math.random() * WAITING_TEASERS.length)]
      setWaitingContent({ type: 'teaser', question: t.q, answer: t.a })
    }
  }

  // ============================================================
  // COUNTDOWN & GAME FLOW
  // ============================================================
  function startCountdown() {
    if (waitingIntervalRef.current) clearInterval(waitingIntervalRef.current)
    setCountdown(3)
    setScreen('countdown')
    setCurrentRound(0)
    setMyScore(0)
    setOpScore(0)
    setMyCorrect(0)
    setOpCorrect(0)
    setMyTimes([])
    setOpTimes([])
    setRoundResults([])

    let c = 3
    const iv = setInterval(() => {
      c--
      setCountdown(c)
      if (c <= 0) {
        clearInterval(iv)
        startRound(0)
      }
    }, 800)
  }

  function startRound(roundIdx) {
    if (roundIdx >= questions.length || roundIdx >= TOTAL_ROUNDS) {
      finishGame()
      return
    }

    const q = questions[roundIdx]
    setCurrentRound(roundIdx)
    setCurrentQuestion(q)
    setSelectedAnswer(null)
    setShowResult(false)
    setTimer(TIME_PER_QUESTION)
    setScreen('question')
    questionStartRef.current = Date.now()
    myAnswerRef.current = { submitted: false, index: null, timeMs: 15000 }
    opAnswerRef.current = null

    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          if (!myAnswerRef.current.submitted) {
            submitAnswer(null)
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  // ============================================================
  // SUBMIT ANSWER
  // ============================================================
  const submitAnswer = useCallback(async (idx) => {
    if (myAnswerRef.current.submitted) return

    const timeMs = Date.now() - questionStartRef.current
    myAnswerRef.current = { submitted: true, index: idx, timeMs }

    if (timerRef.current) clearInterval(timerRef.current)

    const q = questions[currentRound]
    if (!q) return

    const isCorrect = idx === q.correct_index
    const score = calcScore(isCorrect, timeMs)

    setSelectedAnswer(idx)
    setShowResult(true)

    if (isCorrect) {
      setMyScore(prev => prev + score)
      setMyCorrect(prev => prev + 1)
    }
    setMyTimes(prev => [...prev, timeMs / 1000])

    // Write to Supabase
    await supabase.from('answers').insert({
      game_id: gameId,
      player_id: user.id,
      question_id: q.id,
      round_number: currentRound,
      selected_index: idx,
      is_correct: isCorrect,
      time_taken_ms: timeMs,
      score_earned: score,
    })

    // Simulate opponent for now (until real multiplayer is tested)
    // In production, the realtime subscription handles this
    if (!opAnswerRef.current) {
      simulateOpponent(q)
    } else {
      processRound(opAnswerRef.current)
    }
  }, [currentRound, questions, gameId, user])

  function simulateOpponent(q) {
    const chance = q.difficulty === 1 ? 0.75 : q.difficulty === 2 ? 0.55 : 0.35
    const isCorrect = Math.random() < chance
    const time = 3000 + Math.random() * 9000
    const score = calcScore(isCorrect, time)

    const fakeAnswer = {
      is_correct: isCorrect,
      time_taken_ms: time,
      score_earned: score,
      selected_index: isCorrect ? q.correct_index : ((q.correct_index + 1) % 4),
    }

    setTimeout(() => {
      processRound(fakeAnswer)
    }, 800)
  }

  function processRound(opAnswer) {
    if (opAnswer.is_correct) {
      setOpScore(prev => prev + opAnswer.score_earned)
      setOpCorrect(prev => prev + 1)
    }
    setOpTimes(prev => [...prev, opAnswer.time_taken_ms / 1000])

    const q = questions[currentRound]
    setRoundResults(prev => [...prev, {
      question: q,
      myAnswer: myAnswerRef.current.index,
      opAnswer: opAnswer.selected_index,
      myCorrect: myAnswerRef.current.index === q?.correct_index,
      opCorrect: opAnswer.is_correct,
      myTimeMs: myAnswerRef.current.timeMs,
      opTimeMs: opAnswer.time_taken_ms,
      myScore: calcScore(myAnswerRef.current.index === q?.correct_index, myAnswerRef.current.timeMs),
      opScore: opAnswer.score_earned,
    }])

    setScreen('roundResult')
    setTimeout(() => startRound(currentRound + 1), 2200)
  }

  // ============================================================
  // FINISH GAME
  // ============================================================
  function finishGame() {
    const myAvg = myTimes.length > 0 ? myTimes.reduce((a, b) => a + b, 0) / myTimes.length : 10
    const opAvg = opTimes.length > 0 ? opTimes.reduce((a, b) => a + b, 0) / opTimes.length : 10

    const mIQ = calcIQ(myScore, myCorrect, TOTAL_ROUNDS, myAvg)
    const oIQ = calcIQ(opScore, opCorrect, TOTAL_ROUNDS, opAvg)

    setMyIQ(mIQ)
    setOpIQ(oIQ)
    setScreen('results')

    // Update game record
    if (gameId) {
      supabase.from('games').update({
        status: 'completed',
        player1_score: isPlayer1Ref.current ? myScore : opScore,
        player2_score: isPlayer1Ref.current ? opScore : myScore,
        player1_iq: isPlayer1Ref.current ? mIQ : oIQ,
        player2_iq: isPlayer1Ref.current ? oIQ : mIQ,
        completed_at: new Date().toISOString(),
      }).eq('id', gameId).then(() => {})
    }
  }

  function goHome() {
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    if (waitingIntervalRef.current) clearInterval(waitingIntervalRef.current)
    setScreen('home')
    setGameId(null)
    setOpponent(null)
    setQuestions([])
    setRoundResults([])
  }

  // ============================================================
  // RENDER
  // ============================================================

  // --- AUTH SCREEN ---
  if (screen === 'auth') return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 32 }}>
      <div>
        <div style={{ width: 72, height: 72, margin: '0 auto 16px', background: 'linear-gradient(135deg, var(--hot), var(--electric))', borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, boxShadow: '0 0 40px rgba(255,51,102,0.3)', animation: 'pulse 3s ease-in-out infinite' }}>🧠</div>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, letterSpacing: -1, background: 'linear-gradient(135deg, var(--text), var(--hot))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Dumb Friend</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: 'var(--muted)', marginTop: 6, letterSpacing: 1.5 }}>EVERYONE'S GOT ONE. PROVE IT'S NOT YOU.</div>
      </div>

      <div style={{ width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {authMode === 'signup' && (
          <input
            style={{ background: '#16162a', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', color: 'var(--text)', fontSize: 15, outline: 'none' }}
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
        )}
        <input
          style={{ background: '#16162a', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', color: 'var(--text)', fontSize: 15, outline: 'none' }}
          placeholder="Email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <input
          style={{ background: '#16162a', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', color: 'var(--text)', fontSize: 15, outline: 'none' }}
          placeholder="Password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAuth()}
        />
        {authError && <div style={{ color: 'var(--hot)', fontSize: 13 }}>{authError}</div>}
        <button className="btn-primary" onClick={handleAuth} disabled={authLoading}>
          {authLoading ? '...' : authMode === 'signup' ? 'Create Account' : 'Sign In'}
        </button>
        <button
          className="btn-secondary"
          onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError('') }}
        >
          {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  )

  // --- HOME SCREEN ---
  if (screen === 'home') return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 40 }}>
      <div>
        <div style={{ width: 80, height: 80, margin: '0 auto 20px', background: 'linear-gradient(135deg, var(--hot), var(--electric))', borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, boxShadow: '0 0 40px rgba(255,51,102,0.3)', animation: 'pulse 3s ease-in-out infinite' }}>🧠</div>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 36, letterSpacing: -1, background: 'linear-gradient(135deg, var(--text), var(--hot))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1.1 }}>Dumb Friend</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: 'var(--muted)', marginTop: 8, letterSpacing: 2 }}>EVERYONE'S GOT ONE</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 300 }}>
        <button className="btn-primary" onClick={createGame}>⚡ Challenge a Friend</button>
        <button className="btn-secondary" onClick={() => setScreen('join')}>🎯 Join Game</button>
        <button className="btn-secondary" onClick={() => supabase.auth.signOut()} style={{ fontSize: 13, padding: 12, color: 'var(--dim)' }}>
          Sign Out ({profile?.username})
        </button>
      </div>

      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'var(--dim)' }}>v1.0 • 7 rounds • real-time</div>
    </div>
  )

  // --- JOIN SCREEN ---
  if (screen === 'join') return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 32 }}>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 28, letterSpacing: 2 }}>ENTER ROOM CODE</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Get the code from your friend</div>
      </div>

      <input
        style={{ background: '#16162a', border: '1px solid var(--border)', borderRadius: 16, padding: '20px', color: 'var(--gold)', fontSize: 32, fontFamily: "'Space Mono', monospace", textAlign: 'center', letterSpacing: 8, width: 220, outline: 'none', textTransform: 'uppercase' }}
        maxLength={4}
        value={joinCode}
        onChange={e => setJoinCode(e.target.value.toUpperCase())}
        onKeyDown={e => e.key === 'Enter' && joinGame()}
        autoFocus
        placeholder="____"
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 300 }}>
        <button className="btn-primary" onClick={joinGame} disabled={joinCode.length !== 4}>Join Game</button>
        <button className="btn-secondary" onClick={goHome}>← Back</button>
      </div>
    </div>
  )

  // --- LOBBY (WAITING) SCREEN ---
  if (screen === 'lobby') return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 28 }}>
      <div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'var(--muted)', letterSpacing: 1.5, textTransform: 'uppercase' }}>Room Code</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 36, fontWeight: 700, letterSpacing: 8, color: 'var(--gold)', marginTop: 4 }}>{roomCode}</div>
        <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 8 }}>Share this code with your friend</div>
      </div>

      {/* Waiting content card */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: '24px 20px', width: '100%', maxWidth: 340, minHeight: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        {waitingContent?.type === 'teaser' ? (
          <>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: 'var(--electric)', textTransform: 'uppercase', letterSpacing: 2 }}>Brain Teaser</div>
            <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5, color: 'var(--text)' }}>{waitingContent.question}</div>
            <div
              onClick={() => setTeaserRevealed(true)}
              style={{ fontSize: 14, color: teaserRevealed ? 'var(--cyan)' : 'var(--dim)', fontWeight: 600, padding: '10px 20px', borderRadius: 10, background: teaserRevealed ? 'rgba(6,214,160,0.08)' : 'rgba(255,255,255,0.04)', border: `1px solid ${teaserRevealed ? 'rgba(6,214,160,0.2)' : 'rgba(255,255,255,0.08)'}`, cursor: 'pointer' }}
            >
              {teaserRevealed ? waitingContent.answer : 'Tap to reveal'}
            </div>
          </>
        ) : waitingContent?.type === 'taunt' ? (
          <>
            <div style={{ fontSize: 16 }}>💀</div>
            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, color: 'var(--gold)' }}>{waitingContent.text}</div>
          </>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--dim)', animation: `dotPulse 1.4s ease-in-out infinite ${i * 0.2}s` }} />
        ))}
      </div>
      <div style={{ fontSize: 14, color: 'var(--muted)' }}>Waiting for opponent...</div>

      <button className="btn-secondary" onClick={goHome} style={{ maxWidth: 200 }}>Cancel</button>
    </div>
  )

  // --- COUNTDOWN SCREEN ---
  if (screen === 'countdown') return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div key={countdown} style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 140, background: 'linear-gradient(135deg, var(--hot), var(--electric))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'countPop 0.6s ease both', lineHeight: 1 }}>{countdown}</div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 14, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 3, marginTop: 16 }}>Get Ready</div>
    </div>
  )

  // --- QUESTION SCREEN ---
  if (screen === 'question' && currentQuestion) {
    const q = currentQuestion
    const keys = ['A', 'B', 'C', 'D']
    const progress = (currentRound / TOTAL_ROUNDS) * 100
    const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options

    return (
      <div className="screen" style={{ paddingTop: 20, gap: 0 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16 }}>
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: 'var(--muted)' }}>{currentRound + 1} / {TOTAL_ROUNDS}</span>
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 15, fontWeight: 700, color: 'var(--hot)', minWidth: 44, textAlign: 'right', animation: timer <= 5 ? 'timerFlash 0.5s ease infinite' : 'none' }}>{timer}s</span>
        </div>

        {/* Progress bar */}
        <div style={{ width: '100%', height: 4, background: 'var(--bg-card)', borderRadius: 2, overflow: 'hidden', marginBottom: 28 }}>
          <div style={{ height: '100%', background: 'linear-gradient(90deg, var(--electric), var(--hot))', borderRadius: 2, width: `${progress}%`, transition: 'width 0.3s ease' }} />
        </div>

        {/* Category */}
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'var(--electric)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>
          {(q.category || '').replace(/_/g, ' ')}
        </div>

        {/* Question */}
        <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4, marginBottom: 32, minHeight: 80 }}>
          {q.question_text}
        </div>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
          {opts.map((opt, i) => {
            let bg = 'var(--bg-card)'
            let border = 'var(--border)'
            let keyBg = 'rgba(255,255,255,0.05)'
            let keyColor = 'var(--muted)'

            if (showResult) {
              if (i === q.correct_index) {
                bg = 'var(--correct-bg)'; border = 'var(--cyan)'; keyBg = 'var(--cyan)'; keyColor = 'var(--bg)'
              } else if (i === selectedAnswer && i !== q.correct_index) {
                bg = 'var(--wrong-bg)'; border = 'var(--hot)'; keyBg = 'var(--hot)'; keyColor = 'white'
              }
            } else if (i === selectedAnswer) {
              border = 'var(--electric)'; bg = 'rgba(124,58,237,0.12)'; keyBg = 'var(--electric)'; keyColor = 'white'
            }

            return (
              <button
                key={i}
                onClick={() => !showResult && submitAnswer(i)}
                style={{
                  background: bg, border: `1.5px solid ${border}`, borderRadius: 16, padding: '18px 20px',
                  fontSize: 15, fontWeight: 500, color: 'var(--text)', display: 'flex', alignItems: 'center',
                  gap: 14, textAlign: 'left', transition: 'all 0.2s ease',
                  cursor: showResult ? 'default' : 'pointer',
                  transform: !showResult ? undefined : undefined,
                }}
              >
                <span style={{ width: 32, height: 32, borderRadius: 10, background: keyBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, color: keyColor, flexShrink: 0 }}>{keys[i]}</span>
                <span>{opt}</span>
              </button>
            )
          })}
        </div>

        {/* Score ticker */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0 10px', marginTop: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--cyan)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>You</span>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 15, fontWeight: 700 }}>{myScore}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 15, fontWeight: 700 }}>{opScore}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>{opponent?.username || 'Friend'}</span>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--hot)' }} />
          </div>
        </div>
      </div>
    )
  }

  // --- ROUND RESULT (brief flash between questions) ---
  if (screen === 'roundResult' && currentQuestion) {
    const q = currentQuestion
    const myAns = myAnswerRef.current
    const iCorrect = myAns.index === q.correct_index
    const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options

    return (
      <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 20 }}>
        <div style={{ fontSize: 48 }}>{iCorrect ? '✅' : '❌'}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: iCorrect ? 'var(--cyan)' : 'var(--hot)' }}>
          {iCorrect ? 'Correct!' : 'Wrong!'}
        </div>
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>
          The answer was: <strong style={{ color: 'var(--text)' }}>{opts[q.correct_index]}</strong>
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 24, fontWeight: 700, color: 'var(--cyan)' }}>{myScore}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>You</div>
          </div>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: 'var(--dim)', alignSelf: 'center' }}>VS</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 24, fontWeight: 700, color: 'var(--hot)' }}>{opScore}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{opponent?.username || 'Friend'}</div>
          </div>
        </div>
      </div>
    )
  }

  // --- RESULTS SCREEN ---
  if (screen === 'results') {
    const diff = Math.abs((myIQ || 0) - (opIQ || 0))
    const isTie = myIQ === opIQ
    const iWon = myIQ > opIQ

    let roastCategory = isTie ? 'tie' : diff > 15 ? 'blowout' : 'close'
    const roasts = ROASTS[roastCategory]
    const roast = roasts[Math.floor(Math.random() * roasts.length)]

    const winnerName = iWon ? 'You' : (opponent?.username || 'Friend')
    const loserName = iWon ? (opponent?.username || 'Friend') : 'You'

    return (
      <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 24, paddingTop: 40, paddingBottom: 40 }}>
        {/* Crown */}
        <div style={{ fontSize: 56, animation: 'crownBounce 1s ease both' }}>{isTie ? '🤝' : '👑'}</div>

        {/* Verdict */}
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 26, lineHeight: 1.3, maxWidth: 320 }}>
          {isTie ? (
            <span style={{ color: 'var(--dim)' }}>It's a tie. Nobody wins.</span>
          ) : (
            <>
              <span style={{ background: 'linear-gradient(135deg, var(--gold), #ff9f43)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{winnerName}</span>
              <span> is the </span>
              <span style={{ color: 'var(--cyan)' }}>big brain</span>
              <br />
              <span style={{ color: 'var(--dim)' }}>{loserName}</span>
              <span> is the </span>
              <span style={{ color: 'var(--hot)' }}>smooth brain</span>
            </>
          )}
        </div>

        {/* Roast */}
        <div style={{ fontSize: 15, color: 'var(--muted)', maxWidth: 300, lineHeight: 1.5, fontStyle: 'italic' }}>"{roast}"</div>

        {/* IQ Score cards */}
        <div style={{ display: 'flex', gap: 24, width: '100%', maxWidth: 320 }}>
          <div style={{ flex: 1, background: 'var(--bg-card)', border: `1px solid ${iWon || isTie ? 'rgba(255,214,10,0.3)' : 'var(--border)'}`, borderRadius: 20, padding: '24px 16px', textAlign: 'center', position: 'relative', overflow: 'hidden', boxShadow: iWon ? '0 0 30px rgba(255,214,10,0.1)' : 'none' }}>
            {iWon && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, var(--gold), #ff9f43)' }} />}
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>You</div>
            <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 42, color: iWon ? 'var(--cyan)' : 'var(--hot)' }}>{myIQ}</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: 1 }}>IQ Score</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{myCorrect}/{TOTAL_ROUNDS} correct</div>
          </div>

          <div style={{ flex: 1, background: 'var(--bg-card)', border: `1px solid ${!iWon && !isTie ? 'rgba(255,214,10,0.3)' : 'var(--border)'}`, borderRadius: 20, padding: '24px 16px', textAlign: 'center', position: 'relative', overflow: 'hidden', boxShadow: !iWon && !isTie ? '0 0 30px rgba(255,214,10,0.1)' : 'none' }}>
            {!iWon && !isTie && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, var(--gold), #ff9f43)' }} />}
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{opponent?.username || 'Friend'}</div>
            <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 42, color: !iWon && !isTie ? 'var(--cyan)' : 'var(--hot)' }}>{opIQ}</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: 1 }}>IQ Score</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{opCorrect}/{TOTAL_ROUNDS} correct</div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 300, marginTop: 8 }}>
          <button
            style={{ background: 'linear-gradient(135deg, var(--gold), #ff9f43)', border: 'none', color: 'var(--bg)', fontWeight: 700, fontSize: 15, padding: 16, borderRadius: 14, cursor: 'pointer' }}
            onClick={() => {
              if (navigator.share) {
                navigator.share({ title: 'Dumb Friend', text: `I just IQ-checked my friend. I got ${myIQ} IQ, they got ${opIQ}. Think you're smarter?`, url: window.location.href })
              } else {
                navigator.clipboard.writeText(`I just IQ-checked my friend on Dumb Friend! I got ${myIQ} IQ, they got ${opIQ}. Think you're smarter? ${window.location.href}`)
                alert('Copied to clipboard!')
              }
            }}
          >📸 Share Results</button>
          <button className="btn-primary" onClick={() => { createGame() }}>🔄 Rematch</button>
          <button className="btn-secondary" onClick={goHome}>Home</button>
        </div>
      </div>
    )
  }

  // Fallback
  return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ color: 'var(--dim)' }}>Loading...</div>
    </div>
  )
}
