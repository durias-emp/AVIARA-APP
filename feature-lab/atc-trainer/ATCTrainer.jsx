import { useEffect, useMemo, useRef, useState } from 'react'
import { RADIO_SIM_SCENARIOS } from './atcSimScenario'
import { delay, getScoreTone, scorePilotTransmission, summarizeSession } from './atcTrainerEngine'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Textarea,
} from './ui'
import './ATCTrainer.css'

function IconMic() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3M8 21h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function getRecognitionCtor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function speakControllerLine(text, enabled) {
  if (!enabled || !canSpeak()) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-US'
  utterance.rate = 0.9
  utterance.pitch = 0.84
  utterance.volume = 0.96
  window.speechSynthesis.speak(utterance)
}

function SelectPills({ label, options, value, onChange }) {
  return (
    <div className="atcSim__field">
      <div className="atcSim__fieldLabel">{label}</div>
      <div className="atcSim__pillGrid">
        {options.map((option) => (
          <button
            key={option}
            className="atcSim__selectPill"
            type="button"
            aria-pressed={option === value}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

function SimMap({ scenario, pointKey, activeRouteIds, trafficLevel }) {
  const point = scenario.map.points[pointKey] ?? scenario.map.points.ramp
  const trafficTargets = trafficLevel === 'Busy'
    ? [
        { x: 320, y: 198, label: 'N812SP' },
        { x: 668, y: 198, label: 'N43LA' },
      ]
    : trafficLevel === 'Moderate'
      ? [{ x: 690, y: 198, label: 'N812SP' }]
      : []

  return (
    <div className="atcSimMap" aria-label="Animated airport situation map">
      <svg viewBox={scenario.map.viewBox} role="img">
        <rect className="atcSimMap__grass" x="0" y="0" width="1000" height="620" rx="28" />
        <g className="atcSimMap__runway">
          <rect
            x={scenario.map.runway.x}
            y={scenario.map.runway.y}
            width={scenario.map.runway.width}
            height={scenario.map.runway.height}
            rx="8"
          />
          <line x1="146" y1="200" x2="854" y2="200" />
          <text x="150" y="188">09</text>
          <text x="816" y="224">27</text>
        </g>

        {scenario.map.ramps.map((ramp) => (
          <g className="atcSimMap__ramp" key={ramp.label}>
            <rect x={ramp.x} y={ramp.y} width={ramp.width} height={ramp.height} rx="14" />
            <text x={ramp.x + 16} y={ramp.y + 32}>{ramp.label}</text>
          </g>
        ))}

        {scenario.map.taxiways.map((taxiway) => (
          <g key={taxiway.id}>
            <path
              className={`atcSimMap__taxi ${activeRouteIds.includes(taxiway.id) ? 'atcSimMap__taxi--active' : ''}`}
              d={taxiway.d}
            />
            <text className="atcSimMap__taxiLabel">
              <textPath href={`#${taxiway.id}-path`} startOffset="48%">
                {taxiway.label}
              </textPath>
            </text>
            <path id={`${taxiway.id}-path`} d={taxiway.d} fill="none" opacity="0" />
          </g>
        ))}

        <line className="atcSimMap__holdLine" x1="470" y1="246" x2="530" y2="246" />

        {trafficTargets.map((target) => (
          <g className="atcSimMap__traffic" key={target.label} transform={`translate(${target.x} ${target.y})`}>
            <path d="M0 -12 L36 0 L0 12 L7 0 Z" />
            <text x="-16" y="-20">{target.label}</text>
          </g>
        ))}

        <g
          className="atcSimMap__ownship"
          style={{
            transform: `translate(${point.x}px, ${point.y}px) rotate(${point.heading}deg)`,
          }}
        >
          <circle r="20" />
          <path d="M0 -18 L12 18 L0 10 L-12 18 Z" />
        </g>

        <g className="atcSimMap__pointLabel">
          <rect x="34" y="34" width="236" height="52" rx="14" />
          <text x="52" y="56">Current position</text>
          <text x="52" y="76">{point.label}</text>
        </g>
      </svg>
    </div>
  )
}

function RadioMessage({ message }) {
  const tone = message.score ? getScoreTone(message.score.score) : null
  return (
    <div className={`atcSim__message atcSim__message--${message.role}`}>
      <div className="atcSim__messageMeta">
        <span>{message.label}</span>
        {message.score && (
          <span className={`atcSim__score atcSim__score--${tone}`}>{message.score.score}%</span>
        )}
      </div>
      <div className="atcSim__messageText">{message.text}</div>
      {message.score?.missing.length > 0 && (
        <div className="atcSim__messageMiss">Missing {message.score.missing.join(', ')}</div>
      )}
    </div>
  )
}

export default function ATCTrainer({
  scenarios = RADIO_SIM_SCENARIOS,
  enableSpeechInput = true,
  enableSpeechOutput = true,
  controllerDelayMs = 650,
  onSessionComplete,
}) {
  const scenario = scenarios[0]
  const [mode, setMode] = useState('setup')
  const [config, setConfig] = useState({
    scenarioType: scenario.scenarioType,
    airport: scenario.airport,
    aircraft: scenario.aircraftLabel,
    weather: scenario.weather,
    traffic: scenario.traffic,
    complexity: scenario.difficulty,
  })
  const [exchangeIndex, setExchangeIndex] = useState(0)
  const [pointKey, setPointKey] = useState(scenario.exchanges[0].aircraftPoint)
  const [activeRouteIds, setActiveRouteIds] = useState([])
  const [messages, setMessages] = useState([])
  const [results, setResults] = useState([])
  const [draft, setDraft] = useState('')
  const [audioEnabled, setAudioEnabled] = useState(enableSpeechOutput)
  const [listening, setListening] = useState(false)
  const [speechStatus, setSpeechStatus] = useState('Standby')
  const [controllerThinking, setControllerThinking] = useState(false)
  const transcriptRef = useRef(null)
  const recognitionRef = useRef(null)

  const activeExchange = scenario.exchanges[exchangeIndex]
  const progress = mode === 'debrief'
    ? 100
    : ((exchangeIndex + (messages.length > 0 ? 1 : 0)) / scenario.exchanges.length) * 100
  const score = useMemo(() => summarizeSession(results), [results])
  const speechSupported = enableSpeechInput && Boolean(getRecognitionCtor())

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop?.()
      if (canSpeak()) window.speechSynthesis.cancel()
    }
  }, [])

  function scrollTranscript() {
    window.setTimeout(() => {
      transcriptRef.current?.scrollTo({
        top: transcriptRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }, 40)
  }

  function resetRuntime(nextMode = 'setup') {
    recognitionRef.current?.stop?.()
    if (canSpeak()) window.speechSynthesis.cancel()
    setMode(nextMode)
    setExchangeIndex(0)
    setPointKey(scenario.exchanges[0].aircraftPoint)
    setActiveRouteIds([])
    setMessages([])
    setResults([])
    setDraft('')
    setListening(false)
    setSpeechStatus('Standby')
    setControllerThinking(false)
  }

  function startSimulation() {
    const first = scenario.exchanges[0]
    resetRuntime('running')
    const initialMessage = {
      id: `${first.id}-atc-initial`,
      role: 'atc',
      label: first.controller,
      text: first.controllerLine,
    }
    setMessages([initialMessage])
    setPointKey(first.aircraftPoint)
    setActiveRouteIds(first.route)
    speakControllerLine(first.controllerLine, audioEnabled)
  }

  async function submitTransmission() {
    if (!draft.trim() || controllerThinking || mode !== 'running') return
    const pilotText = draft.trim()
    const analysis = scorePilotTransmission(pilotText, activeExchange)
    const pilotMessage = {
      id: `${activeExchange.id}-pilot-${Date.now()}`,
      role: 'pilot',
      label: activeExchange.transmitLabel,
      text: pilotText,
      score: analysis,
    }

    setDraft('')
    setMessages((prev) => [...prev, pilotMessage])
    setResults((prev) => [...prev, { exchange: activeExchange, text: pilotText, score: analysis }])
    setControllerThinking(true)
    scrollTranscript()

    if (controllerDelayMs > 0) await delay(controllerDelayMs)

    setPointKey(activeExchange.nextPoint)
    setActiveRouteIds(activeExchange.route)

    const atcMessage = {
      id: `${activeExchange.id}-atc-${Date.now()}`,
      role: 'atc',
      label: activeExchange.controller,
      text: activeExchange.nextControllerLine,
    }
    setMessages((prev) => [...prev, atcMessage])
    setControllerThinking(false)
    speakControllerLine(activeExchange.nextControllerLine, audioEnabled)
    scrollTranscript()

    const isLast = exchangeIndex >= scenario.exchanges.length - 1
    if (isLast) {
      window.setTimeout(() => {
        setMode('debrief')
        onSessionComplete?.({ scenario, score: summarizeSession([...results, { exchange: activeExchange, text: pilotText, score: analysis }]) })
      }, 900)
    } else {
      setExchangeIndex((idx) => idx + 1)
    }
  }

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop?.()
      setListening(false)
      setSpeechStatus('Standby')
      return
    }

    const Recognition = getRecognitionCtor()
    if (!speechSupported || !Recognition) {
      setSpeechStatus('Unavailable')
      return
    }

    const recognition = new Recognition()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.continuous = false

    recognition.onstart = () => {
      setListening(true)
      setSpeechStatus('Listening')
    }
    recognition.onresult = (event) => {
      let text = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript
      }
      setDraft(text.trim())
    }
    recognition.onerror = () => {
      setSpeechStatus('Retry')
      setListening(false)
    }
    recognition.onend = () => {
      setListening(false)
      setSpeechStatus('Captured')
    }

    recognitionRef.current = recognition
    recognition.start()
  }

  function loadIdealPhrase() {
    setDraft(activeExchange.ideal)
  }

  return (
    <section className="atcTrainer atcSim">
      <div className="atcTrainer__wrap atcSim__wrap">
        <header className="atcTrainer__topbar atcSim__topbar">
          <div>
            <div className="atcTrainer__eyebrow">PQRH Comms Simulator</div>
            <h1 className="atcTrainer__title">Radio Flight Sim</h1>
          </div>
          <Badge variant={mode === 'running' ? 'success' : 'secondary'}>
            {mode === 'setup' ? 'Setup' : mode === 'running' ? activeExchange.phase : 'Debrief'}
          </Badge>
        </header>

        <div className="atcSim__layout">
          <Card className="atcSim__mapPanel">
            <CardHeader>
              <div className="atcSim__panelTop">
                <div>
                  <CardTitle>{scenario.title}</CardTitle>
                  <CardDescription>{scenario.airportName} · {scenario.subtitle}</CardDescription>
                </div>
                <div className="atcSim__frequency">{activeExchange.frequency}</div>
              </div>
            </CardHeader>
            <CardContent>
              <SimMap
                scenario={scenario}
                pointKey={pointKey}
                activeRouteIds={activeRouteIds}
                trafficLevel={config.traffic}
              />
              <div className="atcSim__statusStrip">
                <Badge>{config.aircraft}</Badge>
                <Badge>{scenario.callsign}</Badge>
                <Badge variant="success">{config.weather.split(' · ')[0]}</Badge>
                <Button
                  type="button"
                  variant={audioEnabled ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setAudioEnabled((value) => !value)}
                >
                  ATC Voice
                </Button>
              </div>
            </CardContent>
          </Card>

          {mode === 'setup' && (
            <Card className="atcSim__sidePanel">
              <CardHeader>
                <CardTitle>Configure Flight</CardTitle>
                <CardDescription>{scenario.intro}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="atcSim__setupGrid">
                  <SelectPills
                    label="Scenario"
                    options={scenario.setup.scenarioTypes}
                    value={config.scenarioType}
                    onChange={(scenarioType) => setConfig((prev) => ({ ...prev, scenarioType }))}
                  />
                  <SelectPills
                    label="Airport"
                    options={scenario.setup.airports}
                    value={config.airport}
                    onChange={(airport) => setConfig((prev) => ({ ...prev, airport }))}
                  />
                  <SelectPills
                    label="Aircraft"
                    options={scenario.setup.aircraft}
                    value={config.aircraft}
                    onChange={(aircraft) => setConfig((prev) => ({ ...prev, aircraft }))}
                  />
                  <SelectPills
                    label="Weather"
                    options={scenario.setup.weather}
                    value={config.weather}
                    onChange={(weather) => setConfig((prev) => ({ ...prev, weather }))}
                  />
                  <SelectPills
                    label="Traffic"
                    options={scenario.setup.traffic}
                    value={config.traffic}
                    onChange={(traffic) => setConfig((prev) => ({ ...prev, traffic }))}
                  />
                  <SelectPills
                    label="Complexity"
                    options={scenario.setup.complexity}
                    value={config.complexity}
                    onChange={(complexity) => setConfig((prev) => ({ ...prev, complexity }))}
                  />
                </div>
                <Button className="uiButton--full" type="button" size="lg" onClick={startSimulation}>
                  Start Simulation
                </Button>
              </CardContent>
            </Card>
          )}

          {mode === 'running' && (
            <Card className="atcSim__sidePanel">
              <CardHeader>
                <CardTitle>{activeExchange.controller}</CardTitle>
                <CardDescription>{activeExchange.pilotPrompt}</CardDescription>
              </CardHeader>
              <CardContent>
                <Progress value={progress} />
                <div className="atcSim__transcript" ref={transcriptRef}>
                  {messages.map((message) => (
                    <RadioMessage key={message.id} message={message} />
                  ))}
                  {controllerThinking && (
                    <div className="atcSim__message atcSim__message--atc">
                      <div className="atcSim__messageMeta">
                        <span>{activeExchange.controller}</span>
                        <span>keying</span>
                      </div>
                      <div className="atcTrainer__wave">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  )}
                </div>

                <div className="atcSim__composer">
                  <div className="atcSim__micColumn">
                    <button
                      className="atcTrainer__mic"
                      type="button"
                      aria-label={listening ? 'Stop recording' : 'Start recording'}
                      aria-pressed={listening}
                      onClick={toggleListening}
                      disabled={controllerThinking}
                    >
                      <IconMic />
                    </button>
                    <div className="atcTrainer__micStatus">{speechStatus}</div>
                  </div>
                  <div className="atcSim__inputColumn">
                    <Textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Pilot transmission"
                      disabled={controllerThinking}
                    />
                    <div className="atcSim__sendRow">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={loadIdealPhrase}
                        disabled={controllerThinking}
                      >
                        Load ideal
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={submitTransmission}
                        disabled={!draft.trim() || controllerThinking}
                      >
                        Transmit
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {mode === 'debrief' && (
            <Card className="atcSim__sidePanel">
              <CardHeader>
                <CardTitle>Session Debrief</CardTitle>
                <CardDescription>Phraseology, readback, timing, and situational awareness.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className={`atcSim__finalScore atcSim__finalScore--${getScoreTone(score)}`}>
                  {score}%
                </div>
                <div className="atcSim__debriefList">
                  {results.map((result) => (
                    <div className="atcSim__debriefItem" key={result.exchange.id}>
                      <div className="atcSim__debriefTop">
                        <strong>{result.exchange.transmitLabel}</strong>
                        <span className={`atcSim__score atcSim__score--${getScoreTone(result.score.score)}`}>
                          {result.score.score}%
                        </span>
                      </div>
                      {result.score.missing.length > 0 && (
                        <div className="atcSim__messageMiss">Missing {result.score.missing.join(', ')}</div>
                      )}
                      <div className="atcSim__ideal">Ideal: {result.exchange.ideal}</div>
                      <div className="atcSim__coach">{result.exchange.coach}</div>
                    </div>
                  ))}
                </div>
                <div className="atcSim__actions">
                  <Button type="button" variant="outline" size="lg" onClick={() => resetRuntime('setup')}>
                    Configure Again
                  </Button>
                  <Button type="button" size="lg" onClick={startSimulation}>
                    Retry Flight
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </section>
  )
}
