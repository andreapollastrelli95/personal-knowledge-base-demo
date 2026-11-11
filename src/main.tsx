import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { seed } from './db'
import { pullOnStart, startSync } from './sync'
import './index.css'

pullOnStart()
  .then(seed)
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode><HashRouter><App /></HashRouter></React.StrictMode>
    )
    startSync()
  })
