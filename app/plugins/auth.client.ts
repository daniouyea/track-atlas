// Si la sesión caduca, cualquier llamada a la API devuelve 401: se recarga para mostrar el login
export default defineNuxtPlugin(() => {
  globalThis.$fetch = $fetch.create({
    onResponseError({ response }) {
      if (response.status === 401) location.reload()
    },
  }) as typeof $fetch
})
