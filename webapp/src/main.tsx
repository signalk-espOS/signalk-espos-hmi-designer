import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyEditorTheme, loadEditorTheme } from './editorTheme'

// Before the first render, so a stored night theme never opens on a
// white flash.
applyEditorTheme(loadEditorTheme())

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
