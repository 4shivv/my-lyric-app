import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import "../styles/Navbar.css";

function Navbar() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Use Vite's environment variable for the backend URL.
  // Make sure you have VITE_BACKEND_URL defined in your Vercel (or local) environment.
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:5001";
  
  useEffect(() => {
    const accessToken = localStorage.getItem("spotify_access_token");
    setIsAuthenticated(!!accessToken);
  }, []);

  const handleLogin = () => {
    // Redirect to the backend's Spotify login endpoint
    window.location.href = `${backendUrl}/api/spotify/login`;
  };

  const handleLogout = async () => {
    try {
      // Call the backend to clear history (if applicable)
      await fetch(`${backendUrl}/api/songs/logout`, { method: "POST" });
      console.log("✅ Cleared history on logout");
      // Remove stored authentication tokens
      localStorage.removeItem("spotify_access_token");
      localStorage.removeItem("spotify_refresh_token");
      // Redirect to home page
      window.location.href = "/";
    } catch (error) {
      console.error("❌ Error during logout:", error);
    }
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  return (
    <nav className="navbar">
      <Link to="/" className="logo-container">
        <img src="/IMG_0862.png" alt="LyricLingo Logo" className="logo-image" />
        <span className="logo-text">LyricLingo</span>
      </Link>

      <button className="mobile-menu-button" onClick={toggleMobileMenu}>
        <span className={`menu-icon ${isMobileMenuOpen ? 'menu-open' : ''}`}></span>
      </button>

      <AnimatePresence>
        <motion.div 
          className={`menu ${isMobileMenuOpen ? 'menu-open' : ''}`}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {isAuthenticated ? (
            <motion.button 
              className="auth-button logout-button"
              onClick={handleLogout}
              style={{ "--item-index": 0 }}
            >
              Logout
            </motion.button>
          ) : (
            <motion.button 
              className="auth-button login-button"
              onClick={handleLogin}
              style={{ "--item-index": 0 }}
            >
              Login with Spotify
            </motion.button>
          )}
          <Link to="/flashcards" style={{ "--item-index": 1 }} onClick={() => setIsMobileMenuOpen(false)}>
            Flashcards
          </Link>
          <Link to="/history" style={{ "--item-index": 2 }} onClick={() => setIsMobileMenuOpen(false)}>
            History
          </Link>
        </motion.div>
      </AnimatePresence>
    </nav>
  );
}

export default Navbar;
