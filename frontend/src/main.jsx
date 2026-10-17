import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { WsProvider } from './contexts/WsContext.jsx';
import { ExperienceProvider } from './contexts/ExperienceContext.jsx';
import { ElementThemeProvider } from './contexts/ElementThemeContext.jsx';
import './index.css';
import './styles/design-system.css';
import './styles/modules.css';
import './styles/elemental.css';
import { ToastProvider } from './components/ui.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <WsProvider>
          <ExperienceProvider><ElementThemeProvider><ToastProvider><App /></ToastProvider></ElementThemeProvider></ExperienceProvider>
        </WsProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
