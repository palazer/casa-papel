import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { lang } from '@/i18n'

// what reads the page aloud, hyphenates it or sets it in capitals goes by the page's language (DESIGN.md §13)
document.documentElement.lang = lang

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
