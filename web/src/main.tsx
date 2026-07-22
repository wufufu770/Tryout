import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { getStoredTheme, applyTheme } from "./theme";
import { I18nProvider } from "./i18n";
import { initObservability } from "./lib/observability";
import "./index.css";

// 启动时应用已存主题,避免闪烁
applyTheme(getStoredTheme());
// 初始化前端可观测性(错误捕获 + Web Vitals + 上报)
initObservability();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <App />
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>
);
