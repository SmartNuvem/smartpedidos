const AppFooter = () => {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-10 border-t border-gray-100 py-6 text-center text-xs text-gray-400">
      Desenvolvido por{" "}
      <a
        className="underline hover:text-gray-600"
        href="https://www.smartnuvem.com.br"
        target="_blank"
        rel="noopener noreferrer"
      >
        SmartNuvem Informática
      </a>{" "}
      by ChatGPT • © {year} Todos os direitos reservados
    </footer>
  );
};

export default AppFooter;
