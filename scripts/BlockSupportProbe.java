// Maintenance-only vanilla registry probe; run through audit-block-support.mjs.
// Callers: scripts/audit-block-support.mjs
import com.google.gson.Gson;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipFile;

class BlockSupportProbe {
    static final String STATE = "net.minecraft.world.level.block.state.BlockBehaviour$BlockStateBase";
    static final String BLOCK = "net.minecraft.world.level.block.Block";
    static final Map<String, Object> blocks = new TreeMap<>();
    static final Gson gson = new Gson();
    static Object air, zero, up;

    static Class<?> cls(String name) throws Exception { return Class.forName(name); }
    static Object field(String owner, String name) throws Exception { return cls(owner).getField(name).get(null); }
    static Method method(Class<?> owner, String name, Object... args) throws Exception {
        for (Method m : owner.getMethods()) {
            if (!m.getName().equals(name) || m.getParameterCount() != args.length) continue;
            boolean matches = true;
            for (int i = 0; i < args.length; i++) {
                Class<?> type = m.getParameterTypes()[i];
                if (args[i] != null && !type.isPrimitive() && !type.isInstance(args[i])) matches = false;
            }
            if (matches) return m;
        }
        throw new NoSuchMethodException(owner.getName() + "." + name);
    }
    static Object call(String owner, String name, Object target, Object... args) throws Exception {
        return method(cls(owner), name, args).invoke(target, args);
    }
    static String id(Object block) throws Exception {
        return call("net.minecraft.core.Registry", "getKey", field("net.minecraft.core.registries.BuiltInRegistries", "BLOCK"), block)
            .toString().replace("minecraft:", "");
    }
    static Object state(Object block) throws Exception { return call(BLOCK, "defaultBlockState", block); }
    static String entry(Object state) { return state.toString().replaceFirst("^Block\\{minecraft:", "").replace("}", ""); }
    static Object world(Object below, int light) throws Exception {
        return Proxy.newProxyInstance(BlockSupportProbe.class.getClassLoader(), new Class[]{cls("net.minecraft.world.level.LevelReader")}, (p, m, a) -> {
            String name = m.getName();
            if (name.equals("getBlockState") || name.equals("getFluidState") || name.equals("isEmptyBlock")) {
                int y = (int)call("net.minecraft.core.Vec3i", "getY", a[0]);
                Object s = y < 0 ? below : air;
                return name.equals("getBlockState") ? s : call(STATE, name.equals("getFluidState") ? "getFluidState" : "isAir", s);
            }
            if (name.equals("getRawBrightness")) return light;
            if (name.equals("getBlockEntity")) return null; // No live/open block entities in this probe.
            throw new UnsupportedOperationException("Unmodeled world query: " + name);
        });
    }
    static String owner(Object block, String name) {
        for (Class<?> c = block.getClass(); c != null; c = c.getSuperclass()) {
            for (Method m : c.getDeclaredMethods()) if (m.getName().equals(name)) return c.getSimpleName();
        }
        throw new IllegalStateException("Missing method: " + name);
    }
    static Map<String, List<String>> bindTags(ZipFile jar, String kind, String owner) throws Exception {
        var tags = new TreeMap<String, List<String>>();
        for (var e : Collections.list(jar.entries())) {
            String prefix = "data/minecraft/tags/" + kind + "/";
            if (!e.getName().startsWith(prefix) || !e.getName().endsWith(".json")) continue;
            var data = gson.fromJson(new String(jar.getInputStream(e).readAllBytes(), java.nio.charset.StandardCharsets.UTF_8), com.google.gson.JsonObject.class);
            var values = new ArrayList<String>();
            for (var value : data.getAsJsonArray("values")) values.add(value.isJsonPrimitive() ? value.getAsString() : value.getAsJsonObject().get("id").getAsString());
            tags.put(e.getName().substring(prefix.length(), e.getName().length() - 5), values);
        }
        Object registryKey = field("net.minecraft.core.registries.Registries", kind.toUpperCase(Locale.ROOT));
        Method bind = cls("net.minecraft.core.Holder$Reference").getDeclaredMethod("bindTags", Collection.class);
        bind.setAccessible(true);
        var memberships = new HashMap<String, List<Object>>();
        for (String tag : tags.keySet()) {
            Object key = call("net.minecraft.tags.TagKey", "create", null, registryKey,
                call("net.minecraft.resources.Identifier", "parse", null, "minecraft:" + tag));
            for (String block : resolveTag(tag, tags, new HashSet<>())) memberships.computeIfAbsent(block, k -> new ArrayList<>()).add(key);
        }
        Object registry = field("net.minecraft.core.registries.BuiltInRegistries", kind.toUpperCase(Locale.ROOT));
        for (Object value : (Iterable<?>)registry) {
            String id = call("net.minecraft.core.Registry", "getKey", registry, value).toString().replace("minecraft:", "");
            bind.invoke(call(owner, "builtInRegistryHolder", value), memberships.getOrDefault(id, List.of()));
        }
        return tags;
    }
    static Set<String> resolveTag(String tag, Map<String, List<String>> tags, Set<String> visiting) {
        if (!visiting.add(tag)) throw new IllegalStateException("Cyclic tag: " + tag);
        if (!tags.containsKey(tag)) throw new IllegalStateException("Missing tag: " + tag);
        var result = new HashSet<String>();
        for (String value : tags.get(tag)) {
            if (value.startsWith("#")) result.addAll(resolveTag(value.substring(1).replace("minecraft:", ""), tags, visiting));
            else result.add(value.replace("minecraft:", ""));
        }
        visiting.remove(tag);
        return result;
    }
    public static void main(String[] args) throws Exception {
        call("net.minecraft.SharedConstants", "tryDetectVersion", null);
        call("net.minecraft.server.Bootstrap", "bootStrap", null);
        Object registry = field("net.minecraft.core.registries.BuiltInRegistries", "BLOCK");
        for (Object block : (Iterable<?>)registry) blocks.put(id(block), block);
        air = state(blocks.get("air"));
        zero = field("net.minecraft.core.BlockPos", "ZERO");
        up = field("net.minecraft.core.Direction", "UP");
        var supports = Files.readAllLines(Path.of(args[2]));
        try (var jar = new ZipFile(args[0])) {
            var blockTags = bindTags(jar, "block", BLOCK);
            var fluidTags = bindTags(jar, "fluid", "net.minecraft.world.level.material.Fluid");
            var version = gson.fromJson(new String(jar.getInputStream(jar.getEntry("version.json")).readAllBytes(), java.nio.charset.StandardCharsets.UTF_8), com.google.gson.JsonObject.class);
            Object empty = world(air, 15);
            var output = new TreeMap<String, Object>();
            for (var block : blocks.entrySet()) {
                var facts = new LinkedHashMap<String, Object>();
                facts.put("class", block.getValue().getClass().getSimpleName());
                facts.put("gravity", cls("net.minecraft.world.level.block.FallingBlock").isInstance(block.getValue()));
                facts.put("survival", owner(block.getValue(), "canSurvive"));
                facts.put("placement", owner(block.getValue(), "getStateForPlacement"));
                var states = new TreeMap<String, Object>();
                Object definition = call(BLOCK, "getStateDefinition", block.getValue());
                for (Object s : (Iterable<?>)call("net.minecraft.world.level.block.state.StateDefinition", "getPossibleStates", definition)) {
                    Object collision = call(STATE, "getCollisionShape", s, empty, zero);
                    states.put(entry(s), Map.of(
                        "full", call(STATE, "isFaceSturdy", s, empty, zero, up),
                        "center", call(STATE, "isFaceSturdy", s, empty, zero, up, field("net.minecraft.world.level.block.SupportType", "CENTER")),
                        "rigid", call(STATE, "isFaceSturdy", s, empty, zero, up, field("net.minecraft.world.level.block.SupportType", "RIGID")),
                        "collision", call(BLOCK, "isFaceFull", null, collision, up),
                        "outline", call(BLOCK, "isFaceFull", null, call(STATE, "getShape", s, empty, zero), up),
                        "partial", !(boolean)call("net.minecraft.world.phys.shapes.VoxelShape", "isEmpty", call("net.minecraft.world.phys.shapes.VoxelShape", "getFaceShape", collision, up)),
                        "solid", call(STATE, "isSolid", s),
                        "fallThrough", call("net.minecraft.world.level.block.FallingBlock", "isFree", null, s)));
                }
                facts.put("states", states);
                facts.put("default", entry(state(block.getValue())));
                // A positive result is only a lower bound: this does not simulate every neighborhood.
                var survival = new TreeMap<String, Object>();
                for (String support : supports) {
                    if (!blocks.containsKey(support)) throw new IllegalStateException("Unknown probe substrate: " + support);
                    Object base = state(blocks.get(support));
                    // Test the pair assuming the base is stable; geometry checks its own support separately.
                    if (support.equals("scaffolding")) base = call("net.minecraft.world.level.block.state.StateHolder", "setValue", base,
                        field("net.minecraft.world.level.block.ScaffoldingBlock", "DISTANCE"), 0);
                    try { survival.put(support, call(STATE, "canSurvive", state(block.getValue()), world(base, 15), zero)); }
                    catch (Exception e) { survival.put(support, "unmodeled"); }
                }
                facts.put("on", survival);
                output.put(block.getKey(), facts);
            }
            Files.writeString(Path.of(args[1]), gson.toJson(Map.of("schema", 1, "version", version.get("id").getAsString(),
                "dataVersion", version.get("world_version").getAsInt(), "blocks", output, "blockTags", blockTags, "fluidTags", fluidTags)));
        }
    }
}
