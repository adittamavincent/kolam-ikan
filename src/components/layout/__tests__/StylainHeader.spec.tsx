import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StylainHeader from "../StylainHeader";

describe("StylainHeader component", () => {
  beforeEach(() => {
    window.localStorage.removeItem("stylain:mode");
    document.documentElement.classList.remove("stylain-ide");
  });

  it("renders and toggles mode", async () => {
    render(<StylainHeader />);
    const btn = screen.getByRole("button");
    expect(btn).toBeTruthy();
    await userEvent.click(btn);
    // after click expect class toggled and localStorage updated
    expect(localStorage.getItem("stylain:mode")).toBe("B");
    expect(document.documentElement.classList.contains("stylain-ide")).toBe(true);
  });
});
