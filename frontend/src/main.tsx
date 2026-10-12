import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/ToastProvider';
import { EditorDockProvider } from './components/EditorDock';
import { ThemeProvider } from './theme/ThemeProvider';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <EditorDockProvider>
          <App />
        </EditorDockProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);