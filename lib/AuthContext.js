// lib/AuthContext.js
// Client-side React context for authentication, backed by real server session APIs (/api/auth/login, /api/auth/logout, /api/auth/me).

"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // On mount, verify existing session with server
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error("Failed to verify user session with server", err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  /**
   * Logs in against /api/auth/login
   */
  const login = async (emailOrUsername, password) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailOrUsername, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        setUser(data.user);
        return { success: true, user: data.user };
      }

      return {
        success: false,
        status: res.status,
        error: data.error || "Invalid email or password",
      };
    } catch (err) {
      console.error("Login network error:", err);
      return {
        success: false,
        error: "Unable to reach the authentication service. Please check connection.",
      };
    }
  };

  /**
   * Logs out against /api/auth/logout
   */
  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("Logout network error:", err);
    } finally {
      setUser(null);
      router.push("/login");
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
