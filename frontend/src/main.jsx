import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { WsProvider } from './contexts/WsContext.jsx';
import { ExperienceProvider } from './contexts/ExperienceContext.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <WsProvider>
          <ExperienceProvider><App /></ExperienceProvider>
        </WsProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
