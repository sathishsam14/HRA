/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
    "./lib/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        page: "#F8FAFC",
        navy: {
          DEFAULT: "#12306B",
          dark: "#0E2554",
          light: "#1B418E",
        },
        primary: {
          DEFAULT: "#2563EB",
          hover: "#1D4ED8",
        },
        border: "#E2E8F0",
        tableHeader: "#F1F5F9",
        selectedRow: "#EFF6FF",
        pill: {
          green: {
            bg: "#DCFCE7",
            text: "#166534",
          },
          amber: {
            bg: "#FEF3C7",
            text: "#92400E",
          },
          red: {
            bg: "#FEE2E2",
            text: "#991B1B",
          },
          grey: {
            bg: "#F1F5F9",
            text: "#475569",
          },
        },
      },
    },
  },
  plugins: [],
};
