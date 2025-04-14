'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import styles from './Header.module.css';

export const Header = () => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  return (
    <header className={styles.header}>
      <Link href="https://lampbylit.com" target="_blank" rel="noopener noreferrer">
        <Image
          src="/logo.png"
          alt="&amp Logo"
          width={120}
          height={40}
          priority
          className={styles.logo}
        />
      </Link>
      
      <div className={styles.dropdown}>
        <button 
          className={styles.dropdownButton}
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          aria-expanded={isDropdownOpen}
        >
          /pol/
          <svg 
            width="12" 
            height="12" 
            viewBox="0 0 12 12" 
            fill="none" 
            className={`${styles.arrow} ${isDropdownOpen ? styles.arrowUp : ''}`}
          >
            <path 
              d="M2 4L6 8L10 4" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round"
            />
          </svg>
        </button>
        {isDropdownOpen && (
          <div className={styles.dropdownContent}>
            <a 
              href="https://pol-ai-production.up.railway.app/"
              className={styles.dropdownItem}
            >
              /pol/
            </a>
            <a 
              href="https://lit-ai-production.up.railway.app/"
              className={styles.dropdownItem}
            >
              /lit/
            </a>
            <a 
              href="https://xpara-ai-production.up.railway.app/"
              className={styles.dropdownItem}
            >
              /x/
            </a>
          </div>
        )}
      </div>
    </header>
  );
}; 