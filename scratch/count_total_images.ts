import { supabase } from '../lib/supabase'

async function countTotalImages() {
  const { data, error } = await supabase
    .from('courts')
    .select('images, thumbnail_url')
  
  if (error) {
    console.error('Error fetching data:', error)
    return
  }

  const allImages = new Set<string>()
  data.forEach(court => {
    if (court.thumbnail_url) allImages.add(court.thumbnail_url)
    if (Array.isArray(court.images)) {
      court.images.forEach((img: any) => {
        if (typeof img === 'string') allImages.add(img)
        else if (typeof img === 'object' && img?.image) allImages.add(img.image)
      })
    }
  })

  console.log(`Total courts: ${data.length}`)
  console.log(`Total unique image URLs in database: ${allImages.size}`)
}

countTotalImages()
