import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './themes.css'
import './workspace-actions.css'
import { initializePreferences } from './preferences'
import { initializeRemoteWindow } from './remote'

// Apply persisted language and theme before rendering the UI (no wrong-language/theme flash).
void Promise.all([initializePreferences(), initializeRemoteWindow()]).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})
