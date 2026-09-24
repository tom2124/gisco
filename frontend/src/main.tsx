import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/ToastProvider';
import { EditorDockProvider } from './components/EditorDock';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <EditorDockProvider>
        <App />
      </EditorDockProvider>
    </ToastProvider>
  </React.StrictMode>
);
