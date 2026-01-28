/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/web/**/*.{ts,tsx}", "./index.html"],
  theme: {
    extend: {
      colors: {
        "dark-chocolate": "#3B1F0B",
        cream: "#FFF8E7",
        caramel: "#C68B3C",
        "milk-chocolate": "#7B3F00",
      },
    },
  },
  plugins: [],
};
