"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext(null);

export const USERS = [
  {
    username: "admin",
    name: "Admin User",
    role: "Admin",
    password: "demo1234",
  },
  {
    username: "manager",
    name: "Racing Manager",
    role: "Manager",
    password: "demo1234",
  },
  {
    username: "handicapper",
    name: "Handicapper A",
    role: "Handicapper",
    password: "demo1234",
  },
];

const STORAGE_KEY = "hra_auth_user";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        setUser(JSON.parse(stored));
      }
    } catch (err) {
      console.error("Failed to load user from sessionStorage", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = (username, password) => {
    const cleanUser = username?.trim().toLowerCase();
    const found = USERS.find(
      (u) =>
        (u.username.toLowerCase() === cleanUser ||
          (cleanUser === "handicapper_a" && u.username === "handicapper")) &&
        u.password === password
    );

    if (found) {
      const authUser = {
        username: found.username,
        name: found.name,
        role: found.role,
        email: `${found.username}@btc.in`,
      };
      setUser(authUser);
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
      } catch (err) {
        console.error("Failed to save auth to sessionStorage", err);
      }
      return { success: true };
    }

    return {
      success: false,
      error: "Invalid username or password. Please check your credentials.",
    };
  };

  const logout = () => {
    setUser(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error("Failed to remove auth from sessionStorage", err);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, users: USERS }}>
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
