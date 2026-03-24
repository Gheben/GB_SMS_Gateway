import { useEffect, useRef, useState, useCallback } from 'react'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

export function useWebSocket(onMessage) {
  const wsRef = useRef(null)
  const [connected, setConnected] = useState(false)

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      setTimeout(connect, 3000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        onMessage && onMessage(msg)
      } catch {}
    }
  }, [onMessage])

  useEffect(() => {
    connect()
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [connect])

  return { connected }
}
