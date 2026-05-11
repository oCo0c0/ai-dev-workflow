/**
 * @file 应用入口模块
 * @description AI 开发工作台的前端入口文件，负责初始化 React 应用、
 *              配置客户端路由并挂载根组件到 DOM。
 *              采用 React Router v6 的嵌套路由方案，所有页面共享 Layout 布局。
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
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

/**
 * 根组件 - 定义应用的路由结构
 *
 * 使用 BrowserRouter 进行客户端路由，所有业务页面嵌套在 Layout 布局组件中，
 * Layout 负责渲染侧边栏导航和顶部栏等公共 UI。
 *
 * 路由映射:
 *   /           -> 需求管理页面
 *   /workspace  -> 工作空间页面
 *   /plan       -> 开发计划页面
 *   /execution  -> 执行监控页面
 *   /tests      -> 测试结果页面
 *   /skills     -> 技能管理页面
 *   /mcp        -> MCP 配置页面
 *   /pipelines  -> 工作流管道页面
 */
function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route element={<Layout/>}>
                    <Route path="/" element={<RequirementsPage/>}/>
                    <Route path="/workspace" element={<WorkspacePage/>}/>
                    <Route path="/plan" element={<PlanPage/>}/>
                    <Route path="/execution" element={<ExecutionPage/>}/>
                    <Route path="/tests" element={<TestsPage/>}/>
                    <Route path="/skills" element={<SkillsPage/>}/>
                    <Route path="/mcp" element={<MCPPage/>}/>
                    <Route path="/pipelines" element={<PipelinesPage/>}/>
                </Route>
            </Routes>
        </BrowserRouter>
    );
}

// 获取 HTML 中的根挂载节点，以严格模式渲染 React 应用
ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App/>
    </React.StrictMode>
);
