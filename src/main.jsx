import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Analysis from './pages/Analysis.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="min-h-screen flex flex-col">
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center">
        <span className="text-purple-400 font-bold text-lg tracking-wider">DeFi Analysis</span>
      </nav>
      <main className="flex-1 p-6">
        <Analysis />
      </main>
    </div>
  </StrictMode>
)
