/**
 * Palettes ingested from `colors/` (Figma palette cards).
 *
 * Each entry is transcribed from one card: the title becomes the theme name and
 * the hex values are the ones printed on the swatches — not sampled from the
 * image, so what is written here is what the card states.
 *
 * The processed cards live in `colors/ingested/`; anything left directly in
 * `colors/` has not been taken up yet.
 *
 * NOTE on "Seashell garnet afternoon": the card prints #30525C (a dark teal) on
 * a swatch that renders pink, and the same #30525C appears on "Copper
 * aquamarine dream". The printed value is used here, since the hex is what the
 * card asserts, but the source card contradicts itself.
 */

export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

export const PALETTES: Palette[] = [
  { id: 'cocoa-topaz-noonday', name: 'Cocoa topaz noonday', colors: ['#742F14', '#5A84AC', '#C7AC9F', '#FC9C44', '#5C3C2C'] },
  { id: 'amber-walnut-morning', name: 'Amber walnut morning', colors: ['#EBEFEE', '#CCB499', '#C8906D', '#BB6C43', '#4A413C'] },
  { id: 'driftwood-pearl-morning', name: 'Driftwood pearl morning', colors: ['#BC7B6F', '#5A322A', '#E4A499', '#718A9E', '#CCCDC7'] },
  { id: 'rose-quartz-evening', name: 'Rose quartz evening', colors: ['#64242F', '#B44446', '#FC8F8F', '#DFD9D8'] },
  { id: 'ink-wash', name: 'Ink wash', colors: ['#252525', '#CFCFCF', '#7D7D7D', '#545454'] },
  { id: 'sorbet', name: 'Sorbet', colors: ['#CCCCCC', '#EDECEC', '#B7C396', '#FEFEFE', '#E0E7D7', '#BA9A91'] },
  { id: 'vichy', name: 'Vichy', colors: ['#BBBFBF', '#878787', '#05AD98', '#FFFFFF'] },
  { id: 'yacht-club', name: 'Yacht club', colors: ['#F2F0EF', '#BBBDBC', '#245F73', '#733E24'] },
  { id: 'frozen-mist', name: 'Frozen mist', colors: ['#7C7D75', '#ADACA7', '#FCF8D8', '#D9DADF', '#DD700B'] },
  { id: 'copper-aquamarine-dream', name: 'Copper aquamarine dream', colors: ['#DCAA89', '#30525C', '#C35627', '#D6794D', '#4C848D', '#BFB9B5'] },
  { id: 'sandstone-aquamarine-serinity', name: 'Sandstone aquamarine serinity', colors: ['#BC6C50', '#304C53', '#DDAD9C', '#5A2F25', '#AFE0E7'] },
  { id: 'fireside', name: 'Fireside', colors: ['#E76814', '#D8D4BC', '#891A10', '#DC8236', '#B8210F', '#714236'] },
  { id: 'woodland', name: 'Woodland', colors: ['#9F7560', '#9E9E9E', '#AAD31E', '#D4AF9F', '#525034'] },
  { id: 'seashell-garnet-afternoon', name: 'Seashell garnet afternoon', colors: ['#F6C992', '#30525C', '#ACC0D3', '#D396A6', '#09A1A1', '#5484A4'] },
  { id: 'graphite', name: 'Graphite', colors: ['#C1C0C2', '#F5E9E7', '#837D68', '#8A9DB1', '#ECC5C6'] },
  { id: 'jade-pebble-morning', name: 'Jade pebble morning', colors: ['#7B9669', '#E6E6E6', '#6C8480', '#BAC8B1', '#404E3B'] },
  { id: 'pearl', name: 'Pearl', colors: ['#E9E3DE', '#A5937B', '#E3C49B', '#666161', '#AF9AC9'] },
  { id: 'calcite', name: 'Calcite', colors: ['#DDDCDB', '#FD7B41', '#EDBF9B', '#3C4044'] },
  { id: 'neutral-elegance', name: 'Neutral elegance', colors: ['#FFDBBB', '#CCBEB1', '#997E67', '#664930'] },
  { id: 'honey-opal-sunset', name: 'Honey opal sunset', colors: ['#ECB914', '#F6D579', '#9D8108', '#CBB8A0', '#4F3D35'] },
  { id: 'urban-slate', name: 'Urban slate', colors: ['#E9E6E7', '#5E5653', '#7B7F8A', '#AB978C', '#6B7C98'] },
  { id: 'marina', name: 'Marina', colors: ['#FFF1E7', '#B5D2E6', '#326080', '#805232'] },
  { id: 'tropical-jade-sunrise', name: 'Tropical jade sunrise', colors: ['#FCA47C', '#23CED9', '#F9D779', '#A1CCA6', '#097C87'] },
  { id: 'sapphire-nightfall-whisper', name: 'Sapphire nightfall whisper', colors: ['#0474C4', '#5379AE', '#2C444C', '#A8C4EC', '#06457F', '#262B40'] },
  { id: 'sage-peridot-morning', name: 'Sage peridot morning', colors: ['#345C32', '#9CAC54', '#A7F0DD', '#97CD97'] },
  { id: 'lapis-velvet-evening', name: 'Lapis velvet evening', colors: ['#213885', '#ECDFD2', '#5F3475', '#081849', '#CCCACC', '#893172'] },
  { id: 'neptune', name: 'Neptune', colors: ['#8FD9FB', '#4AB5B5', '#6D8BC0', '#525AFF'] },
  { id: 'festive-eve', name: 'Festive eve', colors: ['#2323FF', '#24AEFF', '#C04AFF', '#7E3DFF'] },
  { id: 'turquoise-amber-autumn', name: 'Turquoise amber autumn', colors: ['#304C64', '#26788E', '#A4CCD4', '#E2480C', '#631B08'] },
  { id: 'amethyst-dawn-haze', name: 'Amethyst dawn haze', colors: ['#341C67', '#472F5B', '#C4AEF4', '#CCA4B4', '#DCCE40'] },
  { id: 'terrazzo', name: 'Terrazzo', colors: ['#EDBD95', '#374F4E', '#D1801E', '#DACCC4', '#AA8552'] },
  { id: 'frosted-aura', name: 'Frosted aura', colors: ['#5C7E8F', '#A2A2A2', '#D4DDE2', '#FFFFFF'] },
  { id: 'sapphire-ash-morning', name: 'Sapphire ash morning', colors: ['#35627A', '#E5AEA9', '#B46258', '#A6A9D0', '#F5F5F5', '#8E9A98'] },
  { id: 'tropical-heat', name: 'Tropical heat', colors: ['#00CEC8', '#FCEFC3', '#FF9C5F', '#EB4203'] },
  { id: 'moon-dust', name: 'Moon dust', colors: ['#D3D3FF', '#CEB5FF', '#8EC1DE', '#80A8FF'] },
  { id: 'emerald-lavender-lake', name: 'Emerald lavender lake', colors: ['#248C54', '#89618E', '#95DCE4'] },
  { id: 'sea-side', name: 'Sea Side', colors: ['#26648E', '#4F8FC0', '#53D2DC', '#FFE3B3'] },
  { id: 'velvet', name: 'Velvet', colors: ['#313866', '#50409A', '#964EC2', '#FF7BBF'] },
  { id: 'cove', name: 'Cove', colors: ['#006BBB', '#30A0E0', '#FFC872', '#FFE3B3'] },
  { id: 'turtle', name: 'Turtle', colors: ['#E5EFC1', '#A2D5AB', '#39AEA9', '#557B83'] },
  { id: 'sunrise', name: 'Sunrise', colors: ['#5F236B', '#BE375F', '#ED8554', '#F5EB6D'] },
  { id: 'rose', name: 'Rose', colors: ['#CC184E', '#E84575', '#F76CAE', '#FFE3B3'] },
  { id: 'fruits-basket', name: 'Fruits Basket', colors: ['#E984A2', '#B9CC95', '#F8D49B', '#F8E6CB'] },
  { id: 'pink-la', name: 'Pink LA', colors: ['#7827E6', '#8D39EC', '#AA4FF6', '#EA80FC'] },
  { id: 'periwinkle', name: 'Periwinkle', colors: ['#9A9CEA', '#A2B9EE', '#A2DCEE', '#ADEEE2'] },
  { id: 'strawberry', name: 'Strawberry', colors: ['#F14666', '#EE8980', '#FFCDAA', '#9CB898'] },
  { id: 'sharp-edge', name: 'Sharp edge', colors: ['#898989', '#D9D9D9', '#FF4D4D', '#4DFFBC'] },
];
