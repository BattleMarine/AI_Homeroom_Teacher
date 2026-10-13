import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LlmChat } from "../features/llm-chat/LlmChat";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <nav className="app-view-nav" aria-label="화면 선택"><a href="/?view=llm">실제 LLM 대화</a><a href="/">기존 학습 데모</a></nav>
    {new URLSearchParams(window.location.search).get("view") === "llm" ? <LlmChat /> : <App />}
  </StrictMode>,
);
