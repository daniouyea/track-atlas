// Disposición según el ancho: en escritorio barra lateral plegable (preferencia guardada);
// en móvil el mapa ocupa la pantalla y la barra es una hoja inferior que se abre y se cierra.
export const MOBILE_QUERY = '(max-width: 768px)'

const mobile = ref(false)
const sheetOpen = ref(false)
let watching = false

export function useSidebar() {
  if (!watching && import.meta.client) {
    watching = true
    const mq = matchMedia(MOBILE_QUERY)
    mobile.value = mq.matches
    mq.addEventListener('change', (e) => { mobile.value = e.matches })
  }
  const { state } = useAtlas()

  const collapsed = computed(() => mobile.value ? !sheetOpen.value : state.sidebarCollapsed)
  function setCollapsed(v: boolean) {
    if (mobile.value) sheetOpen.value = !v
    else state.sidebarCollapsed = v
  }
  function openView(view: 'activities' | 'routes') {
    state.sidebarView = view
    setCollapsed(false)
  }

  return { mobile, collapsed, setCollapsed, openView }
}
