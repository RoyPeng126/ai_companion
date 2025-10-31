const HOME_ADDRESS_KEY = 'ai_companion.home.address'
const HOME_LAT_KEY = 'ai_companion.home.lat'
const HOME_LON_KEY = 'ai_companion.home.lon'

export const SAFETY_RADIUS_METERS = 2000

export const TAIWAN_REGIONS = {
  基隆市: ['仁愛區', '信義區', '中正區', '中山區', '安樂區', '暖暖區', '七堵區'],
  台北市: ['中正區', '大同區', '中山區', '松山區', '大安區', '萬華區', '信義區', '士林區', '北投區', '內湖區', '南港區', '文山區'],
  新北市: ['萬里區', '金山區', '板橋區', '汐止區', '深坑區', '石碇區', '瑞芳區', '平溪區', '雙溪區', '貢寮區', '新店區', '坪林區', '烏來區', '永和區', '中和區', '土城區', '三峽區', '樹林區', '鶯歌區', '三重區', '新莊區', '泰山區', '林口區', '蘆洲區', '五股區', '八里區', '淡水區', '三芝區', '石門區'],
  桃園市: ['桃園區', '中壢區', '平鎮區', '八德區', '楊梅區', '蘆竹區', '龜山區', '龍潭區', '大溪區', '大園區', '觀音區', '新屋區', '復興區'],
  新竹市: ['東區', '北區', '香山區'],
  新竹縣: ['竹北市', '湖口鄉', '新豐鄉', '新埔鎮', '關西鎮', '芎林鄉', '寶山鄉', '竹東鎮', '五峰鄉', '橫山鄉', '尖石鄉', '北埔鄉', '峨眉鄉'],
  苗栗縣: ['竹南鎮', '頭份市', '三灣鄉', '南庄鄉', '獅潭鄉', '後龍鎮', '通霄鎮', '苑裡鎮', '苗栗市', '造橋鄉', '頭屋鄉', '公館鄉', '銅鑼鄉', '大湖鄉', '三義鄉', '卓蘭鎮', '西湖鄉', '泰安鄉'],
  台中市: ['中區', '東區', '南區', '西區', '北區', '北屯區', '西屯區', '南屯區', '太平區', '大里區', '霧峰區', '烏日區', '豐原區', '后里區', '石岡區', '東勢區', '新社區', '潭子區', '大雅區', '神岡區', '大肚區', '沙鹿區', '龍井區', '梧棲區', '清水區', '大甲區', '外埔區', '大安區', '和平區'],
  彰化縣: ['彰化市', '芬園鄉', '花壇鄉', '秀水鄉', '鹿港鎮', '福興鄉', '線西鄉', '伸港鄉', '和美鎮', '員林市', '社頭鄉', '永靖鄉', '埔心鄉', '溪湖鎮', '大村鄉', '埔鹽鄉', '田中鎮', '北斗鎮', '田尾鄉', '埤頭鄉', '溪州鄉', '竹塘鄉', '二林鎮', '大城鄉', '芳苑鄉', '二水鄉'],
  南投縣: ['南投市', '中寮鄉', '草屯鎮', '國姓鄉', '埔里鎮', '仁愛鄉', '名間鄉', '集集鎮', '水里鄉', '魚池鄉', '信義鄉', '竹山鎮', '鹿谷鄉'],
  雲林縣: ['斗南鎮', '大埤鄉', '虎尾鎮', '土庫鎮', '褒忠鄉', '東勢鄉', '台西鄉', '崙背鄉', '麥寮鄉', '斗六市', '林內鄉', '古坑鄉', '莿桐鄉', '西螺鎮', '二崙鄉', '北港鎮', '水林鄉', '口湖鄉', '四湖鄉', '元長鄉'],
  嘉義市: ['東區', '西區'],
  嘉義縣: ['番路鄉', '梅山鄉', '竹崎鄉', '阿里山鄉', '中埔鄉', '大埔鄉', '水上鄉', '鹿草鄉', '太保市', '朴子市', '東石鄉', '六腳鄉', '新港鄉', '民雄鄉', '大林鎮', '溪口鄉', '義竹鄉', '布袋鎮'],
  台南市: ['中西區', '東區', '南區', '北區', '安平區', '安南區', '永康區', '歸仁區', '新化區', '左鎮區', '玉井區', '楠西區', '南化區', '仁德區', '關廟區', '龍崎區', '官田區', '麻豆區', '佳里區', '西港區', '七股區', '將軍區', '學甲區', '北門區', '新營區', '後壁區', '白河區', '東山區', '六甲區', '下營區', '柳營區', '鹽水區', '善化區', '大內區', '山上區', '新市區', '安定區'],
  高雄市: ['新興區', '前金區', '苓雅區', '鹽埕區', '鼓山區', '旗津區', '前鎮區', '三民區', '楠梓區', '小港區', '左營區', '仁武區', '大社區', '岡山區', '路竹區', '阿蓮區', '田寮區', '燕巢區', '橋頭區', '梓官區', '彌陀區', '永安區', '湖內區', '鳳山區', '大寮區', '林園區', '鳥松區', '大樹區', '旗山區', '美濃區', '六龜區', '內門區', '杉林區', '甲仙區', '桃源區', '那瑪夏區', '茂林區', '茄萣區'],
  屏東縣: ['屏東市', '三地門鄉', '霧台鄉', '瑪家鄉', '九如鄉', '里港鄉', '高樹鄉', '鹽埔鄉', '長治鄉', '麟洛鄉', '竹田鄉', '內埔鄉', '萬丹鄉', '潮州鎮', '泰武鄉', '來義鄉', '萬巒鄉', '崁頂鄉', '新埤鄉', '南州鄉', '林邊鄉', '東港鎮', '琉球鄉', '佳冬鄉', '新園鄉', '枋寮鄉', '枋山鄉', '春日鄉', '獅子鄉', '車城鄉', '牡丹鄉', '恆春鎮', '滿州鄉'],
  台東縣: ['台東市', '成功鎮', '關山鎮', '卑南鄉', '鹿野鄉', '池上鄉', '東河鄉', '長濱鄉', '太麻里鄉', '大武鄉', '綠島鄉', '海端鄉', '延平鄉', '金峰鄉', '達仁鄉', '蘭嶼鄉'],
  花蓮縣: ['花蓮市', '鳳林鎮', '玉里鎮', '新城鄉', '吉安鄉', '壽豐鄉', '光復鄉', '豐濱鄉', '瑞穗鄉', '富里鄉', '秀林鄉', '萬榮鄉', '卓溪鄉'],
  宜蘭縣: ['宜蘭市', '頭城鎮', '礁溪鄉', '壯圍鄉', '員山鄉', '羅東鎮', '三星鄉', '大同鄉', '五結鄉', '冬山鄉', '蘇澳鎮', '南澳鄉'],
  澎湖縣: ['馬公市', '西嶼鄉', '望安鄉', '七美鄉', '白沙鄉', '湖西鄉'],
  金門縣: ['金城鎮', '金湖鎮', '金沙鎮', '金寧鄉', '烈嶼鄉', '烏坵鄉'],
  連江縣: ['南竿鄉', '北竿鄉', '莒光鄉', '東引鄉']
}

const TILE_LAYER_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors'
const DEFAULT_CENTER = [25.033, 121.5654] // Taipei 101 as fallback
const DEFAULT_ZOOM = 13

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search'

/**
 * Initialize Leaflet map instance within the given container id.
 * Returns the created map and the global Leaflet namespace for convenience.
 */
export function initLeafletMap (containerId, options = {}) {
  if (typeof L === 'undefined') {
    throw new Error('Leaflet must be loaded before calling initLeafletMap')
  }

  const container = document.getElementById(containerId)
  if (!container) {
    throw new Error(`Map container #${containerId} not found`)
  }

  // Leaflet needs an empty container; ensure previous map is discarded if any.
  container.innerHTML = ''

  const map = L.map(containerId, {
    zoomControl: options.zoomControl ?? true
  })

  const [lat, lon] = options.center ?? DEFAULT_CENTER
  map.setView([lat, lon], options.zoom ?? DEFAULT_ZOOM)

  L.tileLayer(TILE_LAYER_URL, {
    attribution: TILE_ATTRIBUTION,
    maxZoom: 19
  }).addTo(map)

  return { map, L }
}

/**
 * Query address via Nominatim.
 * Returns normalized display name with numeric latitude/longitude.
 */
export async function geocodeAddressViaNominatim (input) {
  let query = ''
  if (typeof input === 'string') {
    query = input.trim()
  } else if (input && typeof input === 'object') {
    const { county, district, detail } = input
    const segments = [county, district, detail].map((part) => String(part ?? '').trim()).filter(Boolean)
    query = segments.join(' ')
  }

  if (!query) return null

  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    addressdetails: '1',
    'accept-language': 'zh-TW',
    countrycodes: 'tw'
  })

  const res = await fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: 'application/json' }
  })
  if (!res.ok) {
    throw new Error(`Geocoding failed with status ${res.status}`)
  }

  const payload = await res.json()
  if (!Array.isArray(payload) || payload.length === 0) {
    return null
  }

  const item = payload[0]
  const lat = Number.parseFloat(item.lat)
  const lon = Number.parseFloat(item.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }

  return {
    displayName: item.display_name,
    lat,
    lon
  }
}

export function saveHome ({ address, lat, lon }) {
  if (!address || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('saveHome requires valid address and coordinates')
  }
  localStorage.setItem(HOME_ADDRESS_KEY, address)
  localStorage.setItem(HOME_LAT_KEY, String(lat))
  localStorage.setItem(HOME_LON_KEY, String(lon))
}

export function getStoredHome () {
  const address = localStorage.getItem(HOME_ADDRESS_KEY)
  const lat = Number.parseFloat(localStorage.getItem(HOME_LAT_KEY) ?? '')
  const lon = Number.parseFloat(localStorage.getItem(HOME_LON_KEY) ?? '')

  if (!address || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }

  return { address, lat, lon }
}

/**
 * Calculate Haversine distance (in meters) between two [lat, lon] tuples.
 */
export function haversineDistanceMeters ([lat1, lon1], [lat2, lon2]) {
  const R = 6371000 // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return Math.round(R * c)
}

export function metersToKmString (meters) {
  if (!Number.isFinite(meters)) return '未知距離'
  const km = meters / 1000
  const decimals = km >= 10 ? 1 : 2
  return `${km.toFixed(decimals)} 公里`
}
