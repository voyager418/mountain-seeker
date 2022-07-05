module.exports = {
  runtimeCompiler: true,
  devServer: {
    proxy: {
      '^/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      },
    }
  }
}