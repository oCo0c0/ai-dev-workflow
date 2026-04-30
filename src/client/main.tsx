import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import RequirementsPage from './pages/RequirementsPage';
import WorkspacePage from './pages/WorkspacePage';
import PlanPage from './pages/PlanPage';
import ExecutionPage from './pages/ExecutionPage';
import TestsPage from './pages/TestsPage';
import SkillsPage from './pages/SkillsPage';
import MCPPage from './pages/MCPPage';
import PipelinesPage from './pages/PipelinesPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<RequirementsPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/execution" element={<ExecutionPage />} />
          <Route path="/tests" element={<TestsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/mcp" element={<MCPPage />} />
          <Route path="/pipelines" element={<PipelinesPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
