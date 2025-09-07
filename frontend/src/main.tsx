import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import MainPage from './MainPage.tsx'

// Determine which component to render based on the current path
const Component = window.location.pathname === '/dashboard' ? App : MainPage;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Component />
  </StrictMode>,
)
