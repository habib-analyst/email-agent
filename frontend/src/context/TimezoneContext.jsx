import React, { createContext, useContext, useState, useEffect } from 'react';

const STORAGE_KEY = 'email-agent-tz-countries';

const TimezoneContext = createContext({
  selectedCountries: [],
  setSelectedCountries: () => {},
  toggleCountry: () => {},
});

export function TimezoneProvider({ children }) {
  const [selectedCountries, setSelectedCountries] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const toggleCountry = (id) => {
    setSelectedCountries(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedCountries));
    } catch (e) {}
  }, [selectedCountries]);

  return (
    <TimezoneContext.Provider value={{ selectedCountries, setSelectedCountries, toggleCountry }}>
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone() {
  return useContext(TimezoneContext);
}
