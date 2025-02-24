import React, { useState } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import "../styles/Navbar.css";

function Navbar({ isLoggedIn, setIsLoggedIn }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:5001";
  const navigate = useNavigate();

  const handleLogin = () => {
    window.location.href = `${backendUrl}/api/spotify/login`;
  };

  
  const handleLogout = async () => {
    try {
      await fetch(`${backendUrl}/api/songs/clear`, { method: "DELETE" });
    } catch (error) {
      console.error("Error clearing history on logout:", error);
    }
    localStorage.removeItem("spotify_access_token");
    localStorage.removeItem("spotify_refresh_token");
    setIsLoggedIn(false);
    navigate("/");
  };

  const toggleMobileMenu = () => {
    if (isClosing) return;
    setIsMobileMenuOpen((prev) => !prev);
  };

  const handleMobileNavClick = (path, e) => {
    e.preventDefault();
    setIsClosing(true);
    setIsMobileMenuOpen(false);
    setTimeout(() => {
      navigate(path);
      setIsClosing(false);
    }, 300);
  };

  return (
    <nav className="navbar">
      <Link to="/" className="logo-container" onClick={() => setIsMobileMenuOpen(false)}>
        <img src="/Subject.png" alt="LyricLingo Logo" className="logo-image" />
        <span className="logo-text"></span>
      </Link>

      {/* Desktop Menu */}
      <div className="desktop-menu">
        {isLoggedIn ? (
          <button className="auth-button logout-button" onClick={handleLogout}>
            Logout
          </button>
        ) : (
          <button 
            className="auth-button login-button" 
            onClick={handleLogin}
            aria-label="Login with Spotify"
          >
            <img src="/Spotify_Primary_Logo_RGB_Green.png" alt="Spotify Icon" className="spotify-icon" />
            Login with Spotify
          </button>
        )}
        <NavLink to="/flashcards" className={({ isActive }) => (isActive ? "active" : "")}>
          Flashcards
        </NavLink>
        <NavLink to="/history" className={({ isActive }) => (isActive ? "active" : "")}>
          History
        </NavLink>
      </div>

      {/* Mobile Menu toggler */}
      <button className="mobile-menu-button" onClick={toggleMobileMenu} aria-label="Toggle menu">
        <span className={`menu-icon ${isMobileMenuOpen ? "menu-open" : ""}`}></span>
      </button>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div 
            className={`menu ${isMobileMenuOpen ? "menu-open" : ""}`}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            onAnimationComplete={() => {
              if (!isMobileMenuOpen) setIsClosing(false);
            }}
          >
            {isLoggedIn ? (
              <motion.button 
                className="auth-button logout-button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleLogout();
                }}
                style={{ "--item-index": 0 }}
              >
                Logout
              </motion.button>
            ) : (
              <motion.button 
                className="auth-button login-button"
                onClick={(e) => {
                  setIsMobileMenuOpen(false);
                  handleLogin();
                }}
                style={{ "--item-index": 0 }}
                aria-label="Login with Spotify"
              >
                <img src="/Spotify_Primary_Logo_RGB_Green.png" alt="Spotify Icon" className="spotify-icon" />
                Login with Spotify
              </motion.button>
            )}
            <NavLink 
              to="/flashcards" 
              style={{ "--item-index": 1 }} 
              onClick={(e) => handleMobileNavClick("/flashcards", e)}
            >
              Flashcards
            </NavLink>
            <NavLink 
              to="/history" 
              style={{ "--item-index": 2 }} 
              onClick={(e) => handleMobileNavClick("/history", e)}
            >
              History
            </NavLink>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

export default Navbar;
