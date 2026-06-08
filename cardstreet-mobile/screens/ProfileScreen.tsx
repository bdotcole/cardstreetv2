import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase/client';
import { LinearGradient } from 'expo-linear-gradient';

// Same web origin the scanner talks to; serves the /help page from the Next.js app.
const WEB_URL = process.env.EXPO_PUBLIC_API_URL || 'https://cardstreet-tcg.vercel.app';

export default function ProfileScreen() {
    const [user, setUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLogin, setIsLogin] = useState(true); // Toggle between Login and Sign Up
    const [authLoading, setAuthLoading] = useState(false);

    useEffect(() => {
        checkUser();

        // Listen for auth state changes
        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
            setLoading(false);
        });

        return () => {
            authListener.subscription.unsubscribe();
        };
    }, []);

    const checkUser = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);
        setLoading(false);
    };

    const handleAuth = async () => {
        if (!email || !password) {
            Alert.alert('Error', 'Please enter both email and password.');
            return;
        }

        setAuthLoading(true);
        try {
            if (isLogin) {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;
            } else {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                });
                if (error) throw error;
                Alert.alert('Success', 'Check your email for the confirmation link!');
            }
        } catch (error: any) {
            Alert.alert('Auth Error', error.message);
        } finally {
            setAuthLoading(false);
        }
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
    };

    if (loading) {
        return (
            <View className="flex-1 bg-brand-darker items-center justify-center">
                <ActivityIndicator size="large" color="#06b6d4" />
            </View>
        );
    }

    // --- AUTH VIEW ---
    if (!user) {
        return (
            <SafeAreaView className="flex-1 bg-brand-darker">
                <View className="flex-1 px-8 justify-center">
                    <View className="items-center mb-10">
                        <View className="w-24 h-24 bg-brand-cyan/10 rounded-3xl items-center justify-center mb-6 border border-brand-cyan/20 overflow-hidden relative">
                            <LinearGradient colors={['rgba(6,182,212,0.2)', 'transparent']} className="absolute inset-0" />
                            <Ionicons name="lock-closed" size={40} color="#06b6d4" />
                        </View>
                        <Text className="text-3xl font-black text-white uppercase italic tracking-tight mb-2">
                            {isLogin ? 'Welcome Back' : 'Join CardStreet'}
                        </Text>
                        <Text className="text-slate-400 text-center text-sm">
                            {isLogin
                                ? 'Sign in to access your vault and marketplace.'
                                : 'Create an account to start collecting.'}
                        </Text>
                    </View>

                    <View className="space-y-4">
                        <View>
                            <Text className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Email</Text>
                            <TextInput
                                className="bg-white/5 border border-white/10 rounded-xl h-12 px-4 text-white text-base"
                                placeholder="name@example.com"
                                placeholderTextColor="#64748b"
                                value={email}
                                onChangeText={setEmail}
                                autoCapitalize="none"
                                keyboardType="email-address"
                            />
                        </View>
                        <View>
                            <Text className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Password</Text>
                            <TextInput
                                className="bg-white/5 border border-white/10 rounded-xl h-12 px-4 text-white text-base"
                                placeholder="••••••••"
                                placeholderTextColor="#64748b"
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                            />
                        </View>

                        <TouchableOpacity
                            className="bg-brand-cyan h-14 rounded-xl items-center justify-center shadow-lg shadow-brand-cyan/20 mt-4 active:scale-[0.98]"
                            onPress={handleAuth}
                            disabled={authLoading}
                        >
                            {authLoading ? (
                                <ActivityIndicator color="#0f172a" />
                            ) : (
                                <Text className="text-brand-darker font-black uppercase tracking-widest text-sm">
                                    {isLogin ? 'Sign In' : 'Create Account'}
                                </Text>
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={() => setIsLogin(!isLogin)}
                            className="items-center mt-4"
                        >
                            <Text className="text-slate-500 font-bold text-xs">
                                {isLogin ? "Don't have an account? " : "Already have an account? "}
                                <Text className="text-brand-cyan">{isLogin ? 'Sign Up' : 'Sign In'}</Text>
                            </Text>
                        </TouchableOpacity>

                        <View className="flex-row items-center my-6">
                            <View className="flex-1 h-[1px] bg-white/10" />
                            <Text className="mx-4 text-xs font-bold text-slate-600 uppercase">Or</Text>
                            <View className="flex-1 h-[1px] bg-white/10" />
                        </View>

                        <TouchableOpacity className="bg-white/5 border border-white/10 h-12 rounded-xl flex-row items-center justify-center space-x-2 active:bg-white/10">
                            <Ionicons name="logo-google" size={18} color="white" />
                            <Text className="text-white font-bold text-sm">Continue with Google</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </SafeAreaView>
        );
    }

    // --- PROFILE VIEW ---
    return (
        <SafeAreaView className="flex-1 bg-brand-darker" edges={['top']}>
            <View className="flex-1">
                {/* Header */}
                <View className="items-center py-8 border-b border-white/5 mx-6">
                    <View className="w-24 h-24 rounded-full bg-slate-800 border-2 border-brand-cyan p-1 mb-4">
                        <Image
                            source={{ uri: user.user_metadata?.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.email }}
                            className="w-full h-full rounded-full"
                        />
                        <View className="absolute bottom-0 right-0 bg-brand-cyan w-6 h-6 rounded-full items-center justify-center border border-brand-darker">
                            <Ionicons name="star" size={12} color="#0f172a" />
                        </View>
                    </View>
                    <Text className="text-white text-xl font-bold mb-1">{user.email?.split('@')[0]}</Text>
                    <Text className="text-brand-cyan text-[10px] font-black uppercase tracking-widest bg-brand-cyan/10 px-2 py-0.5 rounded">
                        Gold Member
                    </Text>
                </View>

                {/* Stats */}
                <View className="flex-row justify-between px-6 py-6">
                    <View className="flex-1 bg-white/5 p-4 rounded-xl border border-white/5 mr-2 items-center">
                        <Text className="text-2xl font-black text-white">52</Text>
                        <Text className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Collected</Text>
                    </View>
                    <View className="flex-1 bg-white/5 p-4 rounded-xl border border-white/5 mx-2 items-center">
                        <Text className="text-2xl font-black text-brand-cyan">12</Text>
                        <Text className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">For Sale</Text>
                    </View>
                    <View className="flex-1 bg-white/5 p-4 rounded-xl border border-white/5 ml-2 items-center">
                        <Text className="text-2xl font-black text-emerald-400">4</Text>
                        <Text className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Sold</Text>
                    </View>
                </View>

                {/* Menu */}
                <ScrollView className="px-6 flex-1">
                    <Text className="text-slate-600 text-[10px] font-black uppercase tracking-widest mb-3 mt-2">Account</Text>

                    <TouchableOpacity className="flex-row items-center bg-white/5 p-4 rounded-xl mb-3 active:bg-white/10 border border-white/5">
                        <View className="w-8 h-8 rounded-full bg-blue-500/20 items-center justify-center mr-3">
                            <Ionicons name="person" size={16} color="#3b82f6" />
                        </View>
                        <Text className="text-white font-bold flex-1">Personal Details</Text>
                        <Ionicons name="chevron-forward" size={16} color="#475569" />
                    </TouchableOpacity>

                    <TouchableOpacity className="flex-row items-center bg-white/5 p-4 rounded-xl mb-3 active:bg-white/10 border border-white/5">
                        <View className="w-8 h-8 rounded-full bg-emerald-500/20 items-center justify-center mr-3">
                            <Ionicons name="card" size={16} color="#10b981" />
                        </View>
                        <Text className="text-white font-bold flex-1">Payment Methods</Text>
                        <Ionicons name="chevron-forward" size={16} color="#475569" />
                    </TouchableOpacity>

                    <TouchableOpacity className="flex-row items-center bg-white/5 p-4 rounded-xl mb-3 active:bg-white/10 border border-white/5">
                        <View className="w-8 h-8 rounded-full bg-purple-500/20 items-center justify-center mr-3">
                            <Ionicons name="notifications" size={16} color="#a855f7" />
                        </View>
                        <Text className="text-white font-bold flex-1">Notifications</Text>
                        <Ionicons name="chevron-forward" size={16} color="#475569" />
                    </TouchableOpacity>

                    <Text className="text-slate-600 text-[10px] font-black uppercase tracking-widest mb-3 mt-4">Support</Text>

                    <TouchableOpacity
                        className="flex-row items-center bg-white/5 p-4 rounded-xl mb-3 active:bg-white/10 border border-white/5"
                        onPress={() => Linking.openURL(`${WEB_URL}/help`)}
                    >
                        <View className="w-8 h-8 rounded-full bg-orange-500/20 items-center justify-center mr-3">
                            <Ionicons name="help-buoy" size={16} color="#f97316" />
                        </View>
                        <Text className="text-white font-bold flex-1">Help Center</Text>
                        <Ionicons name="chevron-forward" size={16} color="#475569" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        className="flex-row items-center bg-brand-red/10 p-4 rounded-xl mb-8 active:bg-brand-red/20 border border-brand-red/10 mt-4"
                        onPress={handleSignOut}
                    >
                        <View className="w-8 h-8 rounded-full bg-brand-red/20 items-center justify-center mr-3">
                            <Ionicons name="log-out" size={16} color="#ef4444" />
                        </View>
                        <Text className="text-brand-red font-bold flex-1">Sign Out</Text>
                    </TouchableOpacity>
                </ScrollView>
            </View>
        </SafeAreaView>
    );
}
