import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Rooms are created on first connection, so entering the app needs no API round trip.
if (location.pathname === "/") {
  history.replaceState(null, "", `/r/${crypto.randomUUID()}`);
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
